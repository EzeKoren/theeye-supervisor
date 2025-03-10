'use strict'

const App = require('../app')
const config = require('config')
const Constants = require('../constants')
const dbFilter = require('../lib/db-filter')
const Host = require("../entity/host").Entity
const HostService = require('../service/host')
const logger = require('../lib/logger')('controller:host')
const NotificationService = require('../service/notification')
const Resource = require('../entity/resource').Entity
const router = require('../router')
const TopicsConstants = require('../constants/topics')

module.exports = function (server) {
  const middlewares = [
    server.auth.bearerMiddleware,
    router.resolve.customerNameToEntity({ required: true }),
    router.ensureCustomer,
  ]

  server.get('/:customer/host', middlewares, controller.fetch)

  server.get('/:customer/host/:host',
    middlewares,
    router.resolve.idToEntity({ param: 'host', required: true }),
    controller.get
  )

  /**
   * NEW ROUTES WITH CUSTOMER , TO KEEP IT GENERIC
   */
  server.post('/:customer/host/:hostname',
    middlewares,
    router.requireCredential('agent',{exactMatch:true}), // only agents can create hosts
    controller.create
  )

  /**
   * KEEP OLD ROUTE FOR BACKWARD COMPATIBILITY WITH OLDER AGENTS
   *
   * AGENTS VERSION <= v0.9.1
   */
  server.post('/host/:hostname',
    middlewares,
    router.requireCredential('agent', { exactMatch: true }), // only agents can create hosts
    controller.create
  )

  server.put('/:customer/host/:host/reconfigure',
    middlewares,
    router.resolve.idToEntity({ param: 'host', required: true }),
    router.requireCredential('admin'),
    controller.reconfigure
  )
}

const controller = {
  async reconfigure (req, res, next) {
    try {
      const host = req.host
      const job = await App.jobDispatcher.createAgentUpdateJob(host._id)
      res.send(204)
      next()
    } catch (err) {
      logger.error(err)
      res.send(500, 'Internal Server Error')
    }
  },
  /**
   *
   *
   */
  get (req,res,next) {
    res.send(200, req.host.toObject())
  },
  /**
   *
   *
   */
  fetch (req,res,next) {
    const customer = req.customer
    const query = req.query // query string

    var filter = dbFilter(query.filter||{},{ /** default filters here **/})
    filter.where.customer_id = customer._id.toString()

    Host.fetchBy(filter, function (err,hosts) {
      if (err) {
        logger.error(err)
        return res.send(500, err)
      }

      if (!hosts||hosts.length===0) {
        res.send(200, [])
        return next()
      }

      HostService.populate(hosts, () => {
        res.send(200, hosts||[])
        next()
      })
    })
  },
  /**
   *
   *
   */
  create (req, res, next) {
    const hostname = req.params.hostname
    if (!hostname) {
      return res.send(400,'hostname required')
    }

    logger.log('processing hostname "%s" registration request', hostname)

    registerHostname(req, (error, result) => {
      if (error) {
        logger.error(error)
        return res.send()
      }

      var host = result.host
      var resource = result.resource

      logger.error('host "%s" registration completed.', hostname)

      const response = Object.assign(
        {
          resource_id: resource ? resource._id : null,
          host_id: host._id
        },
        config.agent.core_workers.host_ping
      )

      res.send(200, response)
      next()
    })
  },
  /**
   *
   *
   */
  //config (req, res, next) {
  //  const customer = req.customer
  //  const host = req.host
  //  HostService.config(host, customer, (err, cfg) => {
  //    res.send(200,cfg)
  //  })
  //}
}

/**
 * register a hostname.
 *
 * @author Facundo
 * @param {Object} req
 * @property {Object} req.customer
 * @property {String} req.params.hostname
 * @property {Object} req.body.info hostname information
 * @param {Function} done callback
 * @return null
 */
const registerHostname = (req, done) => {
  const customer = req.customer
  const hostname = req.params.hostname

  // setting up registration properties
  const properties = req.body.info || {}
  properties.agent_version = req.body.version || null

  Host.findOne({
    hostname,
    customer_name: customer.name
  }, (error, host) => {
    if (error) {
      return done(error)
    }

    if (!host) {
      logger.log("hostname '%s' not found.", hostname)

      return HostService.register({
        user: req.user,
        hostname,
        customer,
        info: properties
      }, (err, result) => {
        if (err) { return done(err) }
        done(null, result)

        // async unattended steps
        const host = result.host
        const resource = result.resource
        HostService.provision({
          host,
          resource,
          customer,
          user: req.user,
          skip_auto_provisioning: req.body.skip_auto_provisioning
        })

        NotificationService.generateSystemNotification({
          topic: TopicsConstants.host.registered,
          data: {
            model_type:'Host',
            model: host,
            model_id: host._id,
            hostname,
            organization: customer.name,
            organization_id: customer._id,
            operations: Constants.CREATE
          }
        })
      })
    } else {
      logger.log('host found')

      if (!host.enable) {
        var error = new Error('host is disabled')
        error.statusCode = 400
        return done(error)
      }

      /** update agent reported version **/
      function updateAgentVersion () {
        logger.log('updating agent version')
        host.agent_version = properties.agent_version
        host.last_update = new Date()
        host.save(err => {
          if (err) {
            logger.error(err)
            return 
          }

          const topic = TopicsConstants.agent.version
          App.logger.submit(customer.name, topic, {
            hostname,
            organization: customer.name,
            version: host.agent_version
          }) // topic = topics.agent.version
        })
      }

      updateAgentVersion()

      Resource.findOne({
        host_id: host._id,
        type: 'host'
      }, function(err,resource){
        if (error) {
          logger.error(err)
          return done(err)
        }
        if (!resource) {
          logger.error('resource for registered host "%s" not found', host._id)
          var err = new Error('host resource not found')
          err.statusCode = 500
          return done(err, { host: host })
        }

        return done(null, { host: host, resource: resource })
      })
    }
  })
}
