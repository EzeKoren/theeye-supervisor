const App = require('../../app')
const logger = require('../../lib/logger')('service:jobs')
const Constants = require('../../constants')
const LifecycleConstants = require('../../constants/lifecycle')
const JobConstants = require('../../constants/jobs')
const TaskConstants = require('../../constants/task')
const TopicsConstants = require('../../constants/topics')
const StateConstants = require('../../constants/states')
const JobModels = require('../../entity/job')
const TaskModel = require('../../entity/task').Entity
const TaskEvent = require('../../entity/event').TaskEvent
const JobFactory = require('./factory')
const NotificationService = require('../../service/notification')
const mongoose = require('mongoose')
const RegisterOperation = require('./register')
const { ClientError, ServerError } = require('../../lib/error-handler')

module.exports = {
  fetchBy (filter, next) {
    return JobModels.Job.fetchBy(filter, (err, jobs) => {
      if (err) {
        return next(err)
      }
      if (jobs.length === 0) {
        return next(null, [])
      }
      next(null, jobs)
    })
  },
  /**
   *
   * @param {Object} input
   * @property {User} input.user
   * @property {Host} input.host
   * @property {Customer} input.customer
   * @param {Function} next
   *
   */
  async dispatchNextPendingJobs (input) {
    const { host } = input
    if (!host) {
      return next(new Error('host is required'))
    }

    const groups = await getPendingJobsAllQueues({ host })
    if (groups.length > 0) {
      let idx = 0
      const job = await getNextJobRecursive(idx, groups.map(grp => grp.nextJob))
      if (job !== null) {
        await dispatchJobExecution(job)
        return [ job.publish('agent') ]
      }
    }

    return []
  },
  finishDummyJob (job, input) {
    return new Promise((resolve, reject) => {
      let { task } = input

      JobFactory.prepareTaskArgumentsValues(
        task.arguments_type,
        task.task_arguments,
        input.task_arguments_values,
        (err, args) => {
          if (err) {
            return reject(err)
          }

          App.jobDispatcher.finish(Object.assign({}, input, {
            job,
            result: { output: args },
            state: StateConstants[err?'FAILURE':'SUCCESS']
          }), (err) => {
            if (err) reject(err)
            else resolve()
          })
        }
      )
    })
  },
  /**
   * @return {Promise<Job>}
   */
  restart (input) {
    const { job } = input

    job.trigger_name = null
    job.result = {}
    job.output = {}

    return this.jobInputsReplenish(input)
  },
  /**
   * @return {Promise<Job>}
   */
  async jobInputsReplenish (input) {
    const { job, user } = input

    if (job._type !== JobConstants.SCRIPT_TYPE) {
      throw new Error('only script tasks allowed')
    }

    await JobFactory.restart(input)

    // everything ok
    RegisterOperation(Constants.UPDATE, TopicsConstants.job.crud, { job, user })

    return job
  },
  /**
   *
   * Change job lifecycle from syncing to ready.
   *
   * @param {Job} job
   * @return {Promise<Job>}
   */
  async syncingToReady (job) {
    job.lifecycle = LifecycleConstants.READY
    job.state = StateConstants.IN_PROGRESS
    await job.save()
    RegisterOperation(Constants.UPDATE, TopicsConstants.job.crud, { job })
    return job
  },
  /**
   * @param {Object} input
   * @property {Task} input.task
   * @property {User} input.user
   * @property {Customer} input.customer
   * @property {Boolean} input.notify
   * @property {String[]} input.script_arguments (will be deprecated)
   * @property {String[]} input.task_arguments_values arguments definitions
   * @property {ObjectId} input.workflow_job_id current workflow ejecution
   * @property {ObjectId} input.workflow_job
   * @property {Workflow} input.workflow optional
   */
  async create (input) {
    const { task, workflow } = input
    let job

    if (!task) {
      throw new Error('task is required')
    }

    verifyTaskBeforeExecution(task)

    if (
      task.grace_time > 0 && ( // automatic origin
        input.origin === JobConstants.ORIGIN_WORKFLOW ||
        input.origin === JobConstants.ORIGIN_TRIGGER_BY
      )
    ) {
      job = await scheduleJob(input) // agenda job
    } else {
      job = await createJob(input)
    }

    if (workflow) {
      if (workflow.autoremove_completed_jobs !== false) {
        //await removeExceededJobsCountByWorkflow(workflow, task)
         removeExceededJobsCountByWorkflow(workflow, task)
      }
    } else if (task.autoremove_completed_jobs !== false) {
      //await removeExceededJobsCountByTask(task)
       removeExceededJobsCountByTask(task)
    }

    return job
  },
  /**
   *
   * @param Object input
   * @prop Workflow
   * @prop User
   * @prop Customer
   * @prop Task
   *
   */
  async createByWorkflow (input) {
    const { workflow, user, customer } = input

    // if task is not specified , then use workflow starting task
    let task = input.task
    if (!task) {
      let taskId = workflow.start_task_id
      task = await App.Models.Task.Task.findById(taskId)
      if (!task) {
        throw new Error('workflow first task not found. cannot execute')
      }
    }

    const wJob = await JobFactory.createWorkflow(input)

    // send and wait before creating the job of the first task
    // to ensure dispatching events in order
    await WorkflowJobCreatedNotification({ wJob, customer })

    // create first job
    await this.create(
      Object.assign({}, input, {
        task,
        workflow: input.workflow, // explicit
        workflow_job_id: wJob._id,
        workflow_job: wJob._id
      })
    )

    return wJob
  },
  async createAgentUpdateJob (host_id) {
    const host = await App.Models.Host.Entity.findById(host_id).exec()
    if (!host) {
      throw new Error('Host not found')
    }

    // check if there are update jobs already created for this host
    const jobs = await App.Models.Job.AgentUpdate.find({
      name: JobConstants.AGENT_UPDATE,
      host_id,
      lifecycle: LifecycleConstants.READY
    })

    // return any job
    if (jobs.length !== 0) {
      return jobs[0]
    }

    await App.Models.Job.AgentUpdate.deleteMany({ host_id, name: JobConstants.AGENT_UPDATE })

    const job = new App.Models.Job.AgentUpdate()
    job.host_id = host_id // enforce host_id, just in case
    job.host = host_id // enforce host_id, just in case
    job.customer = host.customer_id
    job.customer_id = host.customer_id
    job.customer_name = host.customer_name
    await job.save()

    logger.log('agent update job created')
    return job
  },
  /**
   *
   * @summary parse incomming job output -> input parameters.
   * @return {[String]} array of strings (json encoded strings)
   *
   */
  parseOutputParameters (output) {
    if (typeof output === 'string') {
      return parseOutputStringAsJSON (output)
    } else {
      if (Array.isArray(output)) {
        return filterOutputArray (output)
      } else {
        return [ JSON.stringify(output) ]
      }
    }
  },
  /**
   *
   * @summary Finalize task execution. Save result and submit to elk
   *
   * @param {Object} input
   * @property {Job} input.job
   * @property {Object} input.result
   * @param {Function} done
   *
   */
  async finish (input, done) {
    try {
      const { job, user } = input
      const result = (input.result ||{})

      let state
      let lifecycle
      let trigger_name

      if (result.killed === true) {
        state = StateConstants.TIMEOUT
        lifecycle = LifecycleConstants.TERMINATED
      } else {
        if (input.state) {
          state = input.state
        } else {
          // assuming success
          state = StateConstants.SUCCESS
        }
        lifecycle = LifecycleConstants.FINISHED
      }

      job.state = state
      job.lifecycle = lifecycle
      job.result = result
      // parse result output
      if (result.output) {
        // data output, can be anything. stringify for security
        let output = result.output
        job.output = this.parseOutputParameters(output)
        job.result.output = (typeof output === 'string') ? output : JSON.stringify(output)
      }

      try {
        let jsonLastline = JSON.parse(result.lastline)
        // looking for state and output
        if (isObject(jsonLastline)) {
          if (jsonLastline.components) {
            job.result.components = jsonLastline.components
          }
          if (jsonLastline.next) {
            job.result.next = jsonLastline.next
          }
          if (jsonLastline.event_name) {
            job.result.event_name = jsonLastline.event_name
          }
        }
      } catch (err) {
        //logger.log(err)
      }

      if (job.result.event_name) {
        job.trigger_name = job.result.event_name
      } else {
        job.trigger_name = (state === StateConstants.FAILURE) ? StateConstants.FAILURE : StateConstants.SUCCESS
      }

      await job.save()
      done(null, job) // continue processing in paralell

      process.nextTick(() => {
        //RegisterOperation(Constants.UPDATE, TopicsConstants.task.result, { job })
        RegisterOperation(Constants.UPDATE, TopicsConstants.job.crud, { job, user })
        App.scheduler.cancelScheduledTimeoutVerificationJob(job) // async
        dispatchFinishedTaskExecutionEvent(job)
        emitJobFinishedNotification({ job })
      })
    } catch (err) {
      logger.error(err)
      done(err)
    }
  },
  /**
   *
   * @summary Cancel Job execution.
   * Cancel if READY or Terminate if ASSIGNED.
   * Else abort
   *
   * @param {Object} input
   * @property {Job} input.job
   *
   */
  cancel (input, next) {
    next || (next=()=>{})

    const { job, user, state } = input
    const result = (input.result ||{})

    const lifecycle = cancelJobNextLifecycle(job)
    if (!lifecycle) {
      let err = new Error(`cannot cancel job. current state lifecycle "${job.lifecycle}" does not allow the transition`)
      err.statusCode = 400
      return next(err)
    }

    job.lifecycle = lifecycle
    job.result = result
    job.output = this.parseOutputParameters(result.output)
    job.state = (state || StateConstants.CANCELED)
    job.save(err => {
      if (err) {
        logger.error('fail to cancel job %s', job._id)
        logger.data(job)
        logger.error(err)
        return next(err)
      }

      next(null, job)
      logger.log('job %s terminated', job._id)
      RegisterOperation(Constants.UPDATE, TopicsConstants.job.crud, { job, user })
    })
  },
  /**
   *
   * @summary create an integration job for the agent.
   *
   * @param {Object}
   * @property {String} integration
   * @property {String} operation
   * @property {Host} host
   * @property {Object} config integration options and configuration
   *
   */
  /**
  createIntegrationJob ({ integration, operation, host, config }, next) {
    const factoryCreate = JobModels.IntegrationsFactory.create

    let props = Object.assign(
      {
        lifecycle: LifecycleConstants.READY,
        origin: JobConstants.ORIGIN_USER,
        operation,
        host,
        host_id: host._id,
        notify: true
      },
      config
    )

    const job = factoryCreate({ integration, props })
    currentIntegrationJob(job, (err, currentJob) => {
      if (err) { return next(err) }
      if (jobInProgress(currentJob) === true) {
        err = new Error('integration job in progress')
        err.statusCode = 423
        logger.error('%o',err)
        return next(err, currentJob)
      }

      // remove old/finished integration job of the same type.
      // cannot be more than one integration job, in the same host at the same time.
      JobModels.Job
        .remove({
          _type: job._type,
          host_id: job.host_id
        })
        .exec(err => {
          if (err) {
            logger.error('Failed to remove old jobs')
            logger.error('%o',err)
            return next(err)
          }

          job.save(err => {
            if (err) logger.error('%o', err)
            next(err, job)
          })
        })
    })
  },
  */
  jobMustHaveATask (job) {
    const result = (
      job._type === JobConstants.SCRAPER_TYPE ||
      job._type === JobConstants.SCRIPT_TYPE ||
      job._type === JobConstants.APPROVAL_TYPE ||
      job._type === JobConstants.DUMMY_TYPE
    )
    return result
  },
  /**
   * @param {String} job_id
   * @return {Promise}
   */
  async jobExecutionTimedOutCheck (job_id) {
    let job = await JobModels.Job.findById(job_id).exec()
    if (!job) {
      // finished / removed / canceled
      return null
    }

    // is still assigned and waiting execution result
    if (job.lifecycle === LifecycleConstants.ASSIGNED) {
      let elapsed = (job.timeout + (60 * 1000)) / 1000
      let elapsedText

      if (elapsed > 60) {
        elapsed = elapsed / 60 // mins
        elapsedText = `${elapsed.toFixed(2)} minutes`
      } else {
        elapsedText = `${elapsed.toFixed(2)} seconds`
      }

      return new Promise( (resolve, reject) => {
        this.cancel({
          job,
          state: StateConstants.TIMEOUT,
          result: {
            killed: true,
            output: [{ message: `The task was terminated after ${elapsedText} due to execution timeout.` }]
          }
        }, err => {
          if (err) reject(err)
          else resolve()
        })
      })
    }

    return null // undefined
  },
  updateWorkflowJobsAcls (wfJob, acl) {
    const promise = App.Models.Job.Job
      .find({ workflow_job_id: wfJob._id })
      .then(jobs => {

        const savePromises = []
        if (jobs.length > 0) {
          for (let job of jobs) {
            job.acl = acl
            savePromises.push(job.save())
          }
        }

        return Promise.all(savePromises)
      })
      .then(saved => {
        logger.log(`${saved.length} jobs updated`)
        return saved
      })
      .catch(err => {
        logger.error(err)
        return err
      })

    return promise
  }
}

const verifyTaskBeforeExecution = (task) => {
  //let taskData = await App.task.populate(task)
  if (!task.customer) {
    throw new Error(`FATAL. Task ${task._id} does not has a customer`)
  }

  if (taskRequireHost(task) && !task.host) {
    throw new Error(`invalid task ${task._id} does not has a host assigned`)
  }

  return
}

const taskRequireHost = (task) => {
  const res = (
    task.type === TaskConstants.TYPE_SCRIPT ||
    task.type === TaskConstants.TYPE_SCRAPER
  )
  return res
}

/**
 * Invoke Job Factory (immediate execution)
 * @param {Object} input
 */
const createJob = async (input) => {
  const { task, user } = input

  const job = await new Promise((resolve, reject) => {
    JobFactory.create(task, input, async (err, job) => {
      if (err) { return reject(err) }

      if (!job) {
        const err = new Error('Job was not created')
        return reject(err)
      }

      if (job.constructor.name !== 'model') {
        const err = new Error('Invalid job returned')
        err.job = job
        return reject(err)
      }

      logger.log('job created.')
      resolve(job)
    })
  })

  // await notification and system log generation
  await RegisterOperation(Constants.CREATE, TopicsConstants.job.crud, { job, user })

  if (task.type === TaskConstants.TYPE_DUMMY) {
    if (job.lifecycle !== LifecycleConstants.ONHOLD) {
      await App.jobDispatcher.finishDummyJob(job, input)
    }
  } else if (TaskConstants.TYPE_NOTIFICATION === task.type) {
    await new Promise((resolve, reject) => {
      App.jobDispatcher.finish(Object.assign({}, input, {
        job,
        result: {},
        state: StateConstants.SUCCESS
      }), (err) => {
        if (err) reject(err)
        else resolve(job)
      })
    })
  }

  return job
}

/**
 * Invoke Job Factory (scheduled, delayed execution)
 *
 * @param {Object} input
 */
const scheduleJob = async (input) => {
  const { customer, user } = input
  const job = await JobFactory.createScheduledJob(input)

  const topic = TopicsConstants.schedule.crud
  const operation = Constants.CREATE
  //await RegisterOperation(Constants.CREATE, topic, { job, user })

  App.notifications.generateSystemNotification({
    topic,
    data: {
      operation,
      organization: customer.name,
      organization_id: customer._id,
      model: job
      //model_id: job._id,
      //model_type: job._type,
    }
  })

  const payload = {
    operation,
    organization: customer.name,
    organization_id: customer._id,
    model: job,
    user_id: (user?.id||null),
    user_email: (user?.email||null),
    user_name: (user?.username||null)
  }

  App.logger.submit(customer.name, topic, payload)

  return job
}

const removeExceededJobsCountByTask = async (task) => {
  const limit = (task.autoremove_completed_jobs_limit || JobConstants.JOBS_LOG_COUNT_LIMIT)

  const task_id = task._id.toString()
  const count = await JobModels.Job.countDocuments({ task_id })

  // if count > limit allowed, then search top 6
  // and destroy the 6th and left the others
  if (count > limit) {
    const jobs = await JobModels.Job
      .find({ task_id })
      .sort({ _id: -1 })
      .limit(limit)

    const lastDoc = jobs[limit - 1]

        // only remove finished jobs
    const result = await JobModels.Job.remove({
      task_id,
      _id: { $lt: lastDoc._id.toString() }, // remove older documents than last
      $and: [
        { lifecycle: { $ne: LifecycleConstants.READY } },
        { lifecycle: { $ne: LifecycleConstants.ASSIGNED } },
        { lifecycle: { $ne: LifecycleConstants.ONHOLD } }
      ]
    })

    logger.debug('exceeded task jobs execution logs removed')
    logger.debug(result)
  }
}

const removeExceededJobsCountByWorkflow = async (workflow, task) => {

  if (task._id.toString() !== workflow.start_task_id.toString()) {
    return
  }

  const workflow_id = workflow._id.toString()
  const limit = (workflow.autoremove_completed_jobs_limit || JobConstants.JOBS_LOG_COUNT_LIMIT)

  const count = await JobModels.Job.countDocuments({
    workflow_id,
    _type: JobConstants.WORKFLOW_TYPE
  })

  if (count <= limit) {
    return
  }

  const jobs = await JobModels.Job.aggregate([
    {
      $match: {
        workflow_id,
        customer_id: workflow.customer_id.toString() // just in case
      }
    }, {
      $group: {
        _id: '$workflow_job_id',
        count: { $sum: 1 },
        jobs: {
          $push: {
            _id: '$_id',
            lifecycle: '$lifecycle'
          }
        }
      }
    }, {
      $match: { _id: { '$ne': null } }
    }, {
      $project: {
        _id: 1,
        finished: {
          $allElementsTrue: {
            $map: {
              input: '$jobs',
              as: 'job',
              in: {
                $or: [
                  { $eq: [ '$$job.lifecycle', LifecycleConstants.FINISHED ] },
                  { $eq: [ '$$job.lifecycle', LifecycleConstants.TERMINATED ] },
                  { $eq: [ '$$job.lifecycle', LifecycleConstants.CANCELED ] },
                  { $eq: [ '$$job.lifecycle', LifecycleConstants.EXPIRED ] },
                  { $eq: [ '$$job.lifecycle', LifecycleConstants.COMPLETED ] }
                ]
              }
            }
          }
        }
      }
    }, {
      $sort: { _id: 1 }
    }
  ])

  // don't wait
  actuallyRemoveWorkflowJobs(jobs, limit)
  return
}

const actuallyRemoveWorkflowJobs = async (jobs, limit) => {

  if (jobs.length > limit) {

    // remove exceeded items
    const shouldDeleteCount = (jobs.length - limit)

    // detect finished tasks
    const canDelete = jobs.filter(job => job.finished === true)

    // finished history exceed limit
    if (canDelete.length > 0) {

      if (canDelete.length > shouldDeleteCount) {
        deleteCount = shouldDeleteCount
      } else {
        deleteCount = canDelete.length // delete all of them
      }

      const promises = []
      while (deleteCount > 0) {
        let job = canDelete[deleteCount - 1]
        const promise = JobModels.Job.remove({
          $or: [
            { workflow_job_id: job._id },
            { _id: mongoose.Types.ObjectId(job._id) }
          ]
        }).catch(err => err)

        promises.push(promise)

        --deleteCount
      }

      Promise.all(promises).then(result => {
        logger.debug(`${promises.length} exceeded workflow jobs execution logs removed`)
        logger.data(result)
      })
    }
  }
}

/*
const jobInProgress = (job) => {
  if (!job) {
    return false
  }
  let inProgress = (
    job.lifecycle === LifecycleConstants.READY ||
    job.lifecycle === LifecycleConstants.ASSIGNED ||
    job.lifecycle === LifecycleConstants.ONHOLD
  )
  return inProgress
}
*/

/**
 *
 * @summary remove old job status, the history is kept in historical database.
 * @param {Task} task
 * @param {Function} next
 *
 */
const removeOldTaskJobs = (task, next) => {
  logger.log('removing old jobs of task %s', task._id)

  let filters = { task_id: task._id }

  JobModels.Job.remove(filters, function (err) {
    if (err) {
      logger.error('Failed to remove old jobs registry for task %s', task._id)
      logger.error(err)
    }
    next(err)
  })
}

/**
 * @summary obtain next valid lifecycle state if apply for current job.lifecycle
 * @param {Job} job
 * @return {String} lifecycle string
 *
 */
const cancelJobNextLifecycle = (job) => {
  if (
    job.lifecycle === LifecycleConstants.READY ||
    job.lifecycle === LifecycleConstants.ONHOLD
  ) {
    return LifecycleConstants.CANCELED
  } else if (job.lifecycle === LifecycleConstants.ASSIGNED) {
    return LifecycleConstants.TERMINATED
  } else {
    // current state cannot be canceled or terminated
    return null
  }
}

/**
 *
 * @summary The task execution is finished.
 * @param {Job} job
 * @param {Object} data
 * @return {Promise}
 *
 */
const dispatchFinishedTaskExecutionEvent = async (job) => {
  try {
    const { task_id, trigger_name } = job
    let topic

    // cannot trigger a workflow event without a task
    if (!task_id) { return }

    const event = await TaskEvent.findOne({
      emitter_id: task_id,
      enable: true,
      name: trigger_name
    })

    if (!event) {
      let warn = `no handler defined for event named ${trigger_name} of task ${task_id}`
      return logger.error(warn)
    }

    // trigger task execution event within a workflow
    if (job.workflow_id && job.workflow_job_id) {
      topic = TopicsConstants.workflow.execution
    } else {
      topic = TopicsConstants.task.execution
    }

    App.eventDispatcher.dispatch({
      topic,
      event,
      data: job.output,
      job
    })
  } catch (err) {
    if (err) { return logger.error(err) }
  }
}

const parseOutputStringAsJSON = (output) => {
  let result
  try { // try to parse as json

    let parsedOutput = JSON.parse(output)
    if (Array.isArray(parsedOutput)) {
      result = filterOutputArray(parsedOutput)
    } else {
      result = [ output ] // object, number, string..
    }

  } catch (e) { // not a valid json string
    result = [ output ]
  }
  return result
}

const filterOutputArray = (outputs) => {
  result = []
  outputs.forEach(val => {
    if (typeof val !== 'string') {
      result.push( JSON.stringify(val) )
    } else {
      result.push(val)
    }
  })
  return result
}

const isObject = (value) => {
  return Object.prototype.toString.call(value) === '[object Object]'
}

/**
 * @return {Promise}
 */
const WorkflowJobCreatedNotification = ({ wJob, customer }) => {
  return App.notifications.generateSystemNotification({
    topic: TopicsConstants.job.crud,
    data: {
      operation: Constants.CREATE,
      organization: customer.name,
      organization_id: customer._id,
      model_id: wJob._id,
      model_type: wJob._type,
      model: wJob
    }
  })
}

/**
 *
 * Emit the event "job finished execution" after all possible outcomes.
 *
 * @return {Promise}
 *
 */
const emitJobFinishedNotification = ({ job }) => {
  // async call
  return App.notifications.generateSystemNotification({
    topic: TopicsConstants.job.finished,
    data: {
      operation: Constants.UPDATE,
      organization: job.customer_name,
      organization_id: job.customer_id,
      model: {
        _id: job._id,
        acl: job.acl
      },
      model_id: job._id,
      model_type: job._type
      //task_id: job.task_id
    }
  })
}

const getPendingJobsAllQueues = ({ host }) => {
  const query = JobModels.Job.aggregate([
    {
      $match: {
        host_id: host._id.toString(),
        lifecycle: LifecycleConstants.READY
      }
    },
    {
      $sort: {
        task_id: 1,
        creation_date: 1
      }
    },
    {
      $group: {
        _id: { "$toObjectId": "$task_id" },
        nextJob: {
          $first: '$$ROOT'
        }
      }
    },
    {
      $lookup: {
        from: 'tasks',
        localField: '_id',
        foreignField: '_id',
        as: 'task'
      }
    },
    {
      $unwind: "$task"
    },
    {
      $match: {
        "task.enabled": {
          $ne: false
        }
      }
    },
    // Priority , FIFO
    {
      $sort: {
        "task.priority": 1,
        "nextJob.creation_date": 1
      }
    }
  ])

  return query
}

/**
 *
 * NOTE: jobs is an array of job data, there are NOT job models
 * cannot use job.save since jobs are not mongoose document
 *
 */
const getNextJobRecursive = async (idx, jobs, terminateRecursion) => {
  if (idx === jobs.length) { return null }

  const job = JobModels.Job.hydrate(jobs[idx])

  // Cancel this job and process next
  if (App.jobDispatcher.jobMustHaveATask(job) && !job.task) {
    await cancelJobExecution(job)
    return getNextJobRecursive(++idx, jobs)
  } else {
    const allowed = await allowedMultitasking(job)
    if (!allowed) {
      // ignore this one
      return getNextJobRecursive(++idx, jobs)
    }

    return job
  }
}

const allowedMultitasking = async (job) => {
  if (
    job._type === JobConstants.NGROK_INTEGRATION_TYPE ||
    job._type === JobConstants.AGENT_UPDATE_TYPE
  ) {
    return true
  }

  if (job.task.multitasking !== false) {
    return true
  }

  const inprogressjob = await JobModels
    .Job
    .findOne({
      task_id: job.task_id,
      _id: {
        $ne: job._id
      },
      lifecycle: LifecycleConstants.ASSIGNED
    })

  return (inprogressjob === null)
}

const dispatchJobExecution = async (job) => {
  job.lifecycle = LifecycleConstants.ASSIGNED
  await job.save()
  RegisterOperation(Constants.UPDATE, TopicsConstants.job.crud, { job })
  App.scheduler.scheduleJobTimeoutVerification(job)
}

const cancelJobExecution = async (job) => {
  job.state = LifecycleConstants.CANCELED
  job.lifecycle = LifecycleConstants.CANCELED
  await job.save()
  RegisterOperation(Constants.UPDATE, TopicsConstants.job.crud, { job })
}
