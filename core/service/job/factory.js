const App = require('../../app')
const JobModels = require('../../entity/job')
const Script = require('../../entity/file').Script
const LifecycleConstants = require('../../constants/lifecycle')
const JobConstants = require('../../constants/jobs')
const TaskConstants = require('../../constants/task')
const StateConstants = require('../../constants/states')
const ErrorHandler = require('../../lib/error-handler')
const logger = require('../../lib/logger')('service:jobs:factory')

const JobsFactory = {
  /**
   * @param Object params
   * @prop Job
   * @prop User
   * @prop Customer
   * @prop Object task_arguments_values
   * @return Promise
   */
  async restart (params) {
    const { job, user, task_arguments_values } = params
    const builder = new JobsBuilderMap[ job.task.type ]({ job })
    return builder.rebuild(user, task_arguments_values)
  },
  /**
   *
   * @param {Task} task task model
   * @param {Object} input
   * @property {Object} input.task_optionals
   * @property {User} input.user
   * @property {Customer} input.customer
   * @param {Function} next
   *
   */
  create (task, input, next) {
    next || (next = () => {})

    if (
      input.origin !== JobConstants.ORIGIN_USER &&
      task.user_inputs === true
    ) {
      // we don't care about automatic arguments,
      // a user must enter the arguments values
      input.lifecycle = LifecycleConstants.ONHOLD
      let argsValues = []
      createJob({ task, vars: input, argsValues: [] })
        .then(job => next(null, job))
        .catch(err => next(err))

      return
    }

    /**
     *
     * @todo remove script_arguments when all agents are version 0.14.1 or higher
     * @todo upgrade templates on db. replace property script_arguments wuth task_arguments
     *
     */
    let argsDefinition = (task.task_arguments || task.script_arguments)
    let inputArgsValues = (input.task_arguments_values || input.script_arguments)

    this.prepareTaskArgumentsValues(
      argsDefinition,
      inputArgsValues,
      (argsErr, argsValues) => {
        createJob({
          task,
          vars: input,
          argsValues,
          beforeSave: (job, callback) => {
            // notification task arguments should not be validated
            if (TaskConstants.TYPE_NOTIFICATION === task.type || !argsErr) {
              return callback()
            }

            // abort execution
            job.result = { log: JSON.stringify(argsErr) }
            job.output = JSON.stringify(argsErr.errors)
            job.state = StateConstants.ERROR
            job.lifecycle = LifecycleConstants.TERMINATED
            callback()
          }
        }).then(job => next(null, job)).catch(err => next(err))
      }
    )
  },
  /**
   *
   * @return {Promise<AgendaJob>}
   *
   */
  createScheduledJob (input) {
    return new Promise( (resolve, reject) => {
      const task = input.task
      const customer = input.customer

      const runDate =  Date.now() + task.grace_time * 1000
      const data = {
        schedule: { runDate },
        task,
        customer,
        user: input.user,
        origin: input.origin,
        notify: true
      }

      App.scheduler.scheduleTask(data, (err, agendaJob) => {
        if (err) {
          logger.error('cannot schedule workflow job')
          logger.error(err)

          return reject(err)
        }

        return resolve(agendaJob)
      })
    })
  },
  /**
   *
   * @param {Object[]} argumentsDefinition stored definition
   * @param {Object{}} argumentsValues user provided values
   * @param {Function} next
   *
   */
  prepareTaskArgumentsValues (argumentsDefinition, argumentsValues, next) {
    let errors = new ErrorHandler()
    let filteredArguments = []

    if ( !Array.isArray(argumentsDefinition) || argumentsDefinition.length === 0 ) {
      // no arguments
      return next(null, [])
    }

    argumentsDefinition.forEach((def, index) => {
      let value = null
      let order

      if (Boolean(def)) {
        // is defined
        if (typeof def === 'string') {
          // fixed values. older version compatibility
          order = index
          vlaue = def
        } else if (def.type) {
          order = def.order
          if (def.type === TaskConstants.ARGUMENT_TYPE_FIXED) {
            value = def.value
          } else {
            // user input required
            let found = searchInputArgumentValueByOrder(argumentsValues, def.order)

            // the argument is not present within the provided request arguments
            if (found === undefined) {
              errors.required(def.label, null, 'task argument is required.')
            } else {
              if (!found) { // null
                value = found
              } else {
                value = (found.value || found)
                if (typeof value !== 'string') {
                  value = JSON.stringify(value)
                }
              }
            }
          }
        } else {
          // argument is not a string and does not has a type
          order = index
          errors.invalid(`arg${index}`, def, 'task argument definition error. malkformed')
        }
      }

      filteredArguments[order] = value
    })

    if (errors.hasErrors()) {
      let name = 'InvalidTaskArguments'
      const err = new Error(name)
      err.name = name
      err.statusCode = 400
      err.errors = errors
      return next(err, filteredArguments)
    }

    next(null, filteredArguments)
  }
}

module.exports = JobsFactory

/**
 *
 * @param {Object} input controlled internal input
 * @property {Object} input.vars request/process provided arguments
 * @property {Task} input.task
 * @property {Object} input.taskOptionals
 * @property {Array} input.argsValues task arguments values
 *
 * @return Promise
 *
 */
const createJob = (input) => {
  const { task } = input

  if ( ! JobsBuilderMap[ task.type ] ) {
    throw new Error(`Invalid or undefined task type ${task.type}`)
  }

  const builder = new JobsBuilderMap[ task.type ]( input )
  return builder.create()
}

const searchInputArgumentValueByOrder = (values, searchOrder) => {
  if (!values || !Array.isArray(values)) { return undefined }

  return values.find((arg, idx) => {
    let order
    if (!arg || !arg.order) {
      order = idx
    } else {
      order = arg.order
    }
    return (order === searchOrder)
  })
}

class AbstractJob {
  constructor (input) {
    this.input = input
    this.task = input.task
    this.vars = input.vars
    this.argsValues = input.argsValues
    this.beforeSave = input.beforeSave
    this.job = null
  }

  /**
   * @return Promise
   */
  async create () {
    try {
      await this.build()
    } catch (err) {
      await this.terminateBuild(err)
    }
    return this.job
  }

  /*
   * create Job and terminate. cannot execute with errors
   */
  async terminateBuild (err) {
    const job = this.job
    job.state = StateConstants.ERROR
    job.lifecycle = LifecycleConstants.TERMINATED
    job.result = { log: JSON.stringify(err.message) }
    job.output = JSON.stringify(err.message)
    await job.save()
  }

  async build () {
    const job = this.job
    await this.setupJobBasicProperties(job)
    return this.saveJob(job)
  }

  async saveJob (job) {
    const beforeSave = this.beforeSave
    if (beforeSave && typeof beforeSave === 'function') {
      await new Promise((resolve, reject) => {
        beforeSave.call(beforeSave, job, (err) => {
          if (err) { reject(err) }
          else { resolve() }
        })
      })
    }

    await job.save()

    this.task.execution_count += 1
    await this.task.save()

    return job
  }

  async setupJobBasicProperties (job) {
    const { task, vars, argsValues } = this
    let acl = (vars.acl || task.acl)

    if (task.workflow_id) {
      if (!vars.workflow_job_id) {
        logger.error('%o', task)
        throw new Error('missing workflow job')
      }

      const wfjob = await App.Models.Job.Workflow.findById(vars.workflow_job_id)
      if (!wfjob) {
        throw new Error('Internal Error. Workflow job not found')
      }

      acl = wfjob.acl

      job.workflow = task.workflow_id
      job.workflow_id = task.workflow_id

      // workflow job instance
      job.workflow_job = vars.workflow_job_id
      job.workflow_job_id = vars.workflow_job_id

    }

    // copy embedded task object
    job.task = Object.assign({}, task.toObject(), {
      customer: null,
      host: null
    }) // >>> add .id  / embedded

    job.logging = (task.logging || false)
    job.task_id = task._id
    job.task_arguments_values = argsValues
    job.host_id = task.host_id
    job.host = task.host_id
    job.name = task.name
    job.state = (vars.state || StateConstants.IN_PROGRESS)
    job.lifecycle = (vars.lifecycle || LifecycleConstants.READY)
    job.customer = vars.customer._id
    job.customer_id = vars.customer._id
    job.customer_name = vars.customer.name
    job.user_id = (vars.user && vars.user.id)
    job.notify = vars.notify
    job.origin = vars.origin
    job.triggered_by = (vars.event && vars.event._id) || null
    job.acl = acl
    return job
  }
}

class ApprovalJob extends AbstractJob {
  constructor (input) {
    super(input)
    this.job = new JobModels.Approval()
  }

  async build () {
    /** approval job is created onhold , waiting approvers decision **/
    const job = this.job
    await this.setupJobBasicProperties(job)

    await this.setDynamicProperties(job)
    job.lifecycle = LifecycleConstants.ONHOLD

    return this.saveJob(job)
  }

  async setDynamicProperties (job) {
    const dynamicSettings = [
      'approvers',
      'success_label',
      'failure_label',
      'cancel_label',
      'ignore_label'
    ]

    const dynamic = this.vars.task_optionals
    if (dynamic) {
      const settings = dynamic[ TaskConstants.TYPE_APPROVAL ]
      if (settings) {
        for (let prop of dynamicSettings) {
          if (settings[prop]) {
            let value = settings[prop]
            if (prop === 'approvers') {
              // should validate
              if (!Array.isArray(value)) {
                throw new Error('Invalid approvers format. Array required')
              }
              if (value.length === 0) {
                throw new Error('Invalid approvers. Need at least one')
              }

              let users = await App.gateway.user.fetch(value, { customer_id: job.customer_id })
              // if not found users , leave undefined
              if (users.length === 0) {
                value = undefined
                throw new Error(`Cannot determine approvers ${JSON.stringify(settings.approvers)}`)
              }

              job['approvers'] = users.map(u => u.id)
            } else {
              job[prop] = value
            }
          }
        }
      }
    } else {
      const task = job.task
      // set default properties
      job.approvers = task.approvers    
      job.success_label = task.success_label
      job.failure_label = task.failure_label
      job.cancel_label = task.cancel_label
      job.ignore_label = task.ignore_label
    }
  }
}

class ScriptJob extends AbstractJob {
  constructor (input) {
    super(input)
    this.job = (input.job || new JobModels.Script())
  }

  async rebuild (user, inputArgs) {
    const job = this.job

    const [ task, script ] = await Promise.all([
      App.Models.Task.ScriptTask.findById(job.task_id),
      App.Models.File.Script.findById(job.script_id)
    ])

    const argsValues = await new Promise( (resolve, reject) => {
      JobsFactory.prepareTaskArgumentsValues(
        task.task_arguments,
        inputArgs,
        (err, args) => {
          if (err) {
            logger.log('%o', err)
            err.statusCode = 400 // input error
            return reject(err)
          }

          resolve(args)
        })
    })

    job.env = Object.assign({}, job.env, {
      THEEYE_JOB_USER: JSON.stringify({
        id: user.id,
        email: user.email
      })
    })

    // replace script with updated version
    job.script = script.toObject()
    job.script_id = script._id
    job.script_runas = task.script_runas
    job.script_arguments = argsValues
    job.task_arguments_values = argsValues
    job.timeout = task.timeout
    job.lifecycle = LifecycleConstants.READY
    job.state = StateConstants.IN_PROGRESS

    await job.save()
  }

  async build () {
    const job = this.job
    const { task, argsValues, vars } = this
    const script = await Script.findById(task.script_id)

    if (!script) {
      const msg = 'cannot create job. script is no longer available'
      logger.error(msg)

      const Err = new Error(msg)
      Err.statusCode = 404
      throw Err
    }

    await this.setupJobBasicProperties(job)

    job.script = script.toObject() // >>> add .id  / embedded
    job.script_id = script._id
    job.script_arguments = argsValues
    job.script_runas = task.script_runas
    job.timeout = task.timeout
    job.env = Object.assign({
      THEEYE_JOB: JSON.stringify({
        id: job._id,
        task_id: task._id
      }),
      THEEYE_JOB_USER: JSON.stringify({
        id: vars.user.id,
        email: vars.user.email
      }),
      THEEYE_JOB_WORKFLOW: JSON.stringify({
        job_id: (vars.workflow_job_id || null),
        id: ( (vars.workflow && vars.workflow.id) || null)
      }),
      THEEYE_ORGANIZATION_NAME: JSON.stringify(vars.customer.name),
      THEEYE_API_URL: JSON.stringify(App.config.system.base_url)
    }, task.env)

    return this.saveJob(job)
  }
}

class ScraperJob extends AbstractJob {
  constructor (input) {
    super(input)
    this.job = new JobModels.Scraper()
  }

  async build () {
    const job = this.job
    await this.setupJobBasicProperties(job)

    job.timeout = this.task.timeout

    return this.saveJob(job)
  }
}

class DummyJob extends AbstractJob {
  constructor (input) {
    super(input)
    this.job = new JobModels.Dummy()
  }
}

class NotificationJob extends AbstractJob {
  constructor (input) {
    super(input)
    this.job = new JobModels.Notification()
  }
}

const JobsBuilderMap = {}
JobsBuilderMap[ TaskConstants.TYPE_SCRIPT ] = ScriptJob
JobsBuilderMap[ TaskConstants.TYPE_SCRAPER ] = ScraperJob
JobsBuilderMap[ TaskConstants.TYPE_APPROVAL ] = ApprovalJob
JobsBuilderMap[ TaskConstants.TYPE_DUMMY ] = DummyJob
JobsBuilderMap[ TaskConstants.TYPE_NOTIFICATION ] = NotificationJob
