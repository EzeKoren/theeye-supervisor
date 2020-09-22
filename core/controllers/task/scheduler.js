const App = require('../../app')
const logger = require('../../lib/logger')('controller:task:scheduler')
const router = require('../../router')
const JobConstants = require('../../constants/jobs')
const resolver = router.resolve

module.exports = function (server) {
  const middlewares = [
    server.auth.bearerMiddleware,
    router.requireCredential('admin'),
    resolver.customerNameToEntity({ required: true }),
    router.ensureCustomer,
    resolver.idToEntity({ param:'task', required: true })
  ]

  server.post(
    '/:customer/task/:task/schedule',
    middlewares,
    // @TODO-DEPRECATED_REMOVE
    // backward compatibility middleware
    // remove 2021-01-01
    (req, res, next) => {
      if (req.body && req.body.scheduleData) {
        let data = req.body.scheduleData
        req.body.runDate = data.runDate
        req.body.repeatEvery = data.repeatEvery
      }
      next()
    },
    controller.create
  )

  server.get('/:customer/task/:task/schedule', middlewares, controller.fetch)

  ///**
  // * this is for the email cancelation
  // * authenticate with a secret token
  // * only valid for this action
  // */
  //server.get('/:customer/task/:task/schedule/:schedule/secret/:secret',[
  //  resolver.idToEntity({param:'task',required:true}),
  //  router.requireSecret('task'),
  //  resolver.customerNameToEntity({required:true}),
  //], controller.remove)
}

const controller = {
  /**
   * Gets schedule data for a task
   * @method GET
   * @route /:customer/task/:task/schedule
   * @param {String} :task , mongo ObjectId
   *
   */
  fetch (req, res, next) {
    const task = req.task
    App.scheduler.getTaskSchedule(task._id, (err, schedule) => {
      if (err) {
        logger.error('Scheduler had an error retrieving data for %s',task._id)
        logger.error(err)
        return res.send(500)
      }

      res.send(200, schedule)
      next()
    })
  },
  /**
   * @method POST
   * @route /:customer/task/:task/schedule
   */
  create (req, res, next) {
    const task = req.task
    const user = req.user
    const customer = req.customer

    const { runDate, repeatEvery } = req.body

    if (!runDate) {
      return res.send(400, 'runDate required')
    }

    App.scheduler.scheduleTask({
      origin: JobConstants.ORIGIN_SCHEDULER,
      task: task,
      customer: customer,
      user: user,
      schedule: { runDate, repeatEvery }
    }, (err, schedule) => {
      if (err) {
        logger.error(err)
        return res.send(500, err)
      }
      res.send(200, schedule)
    })
  }
}
