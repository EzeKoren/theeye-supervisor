'use strict';

var debug = require('debug')('eye:controller:resource');
var json = require('../lib/jsonresponse');
var ResourceManager = require('../service/resource');
var MonitorManager = require('../service/resource/monitor');
var Resource = require('../entity/resource').Entity;
var Monitor = require('../entity/monitor').Entity;
var Host = require('../entity/host').Entity;
var Job = require('../entity/job').Job;
var router = require('../router');
var dbFilter = require('../lib/db-filter');
var ACL = require('../lib/acl');

module.exports = function (server, passport) {
  // default middlewares
  var middlewares = [
    passport.authenticate('bearer',{session:false}),
    router.resolve.customerNameToEntity({required:true}),
    router.ensureCustomer,
  ];

  server.get('/:customer/resource',middlewares.concat([
    router.requireCredential('viewer'),
  ]),controller.fetch);

  server.get('/:customer/resource/:resource',middlewares.concat([
    router.requireCredential('viewer'),
    router.resolve.idToEntity({param:'resource',required:true}),
    router.ensureAllowed({entity:{name:'resource'}})
  ]),controller.get);

  server.post('/:customer/resource',middlewares.concat([
    router.requireCredential('admin'),
    router.filter.spawn({filter:'emailArray',param:'acl'})
  ]),controller.create);

  server.del('/:customer/resource/:resource',middlewares.concat([
    router.requireCredential('admin'),
    router.resolve.idToEntity({param:'resource',required:true})
  ]),controller.remove);


  var updateMiddlewares = middlewares.concat([
    router.requireCredential('agent'),
    router.resolve.idToEntity({param:'resource',required:true}),
    //router.resolve.idToEntity({param:'host_id',entity:'host',into:'host'}),
    router.filter.spawn({filter:'emailArray',param:'acl'})
  ]);
  server.patch('/:customer/resource/:resource', updateMiddlewares, controller.update);

  //
  // KEEP BACKWARD COMPATIBILITY WITH OLDER AGENT VERSIONS.
  // SUPPORTED FROM VERSION v0.9.3-beta-11-g8d1a93b
  //
  server.put('/:customer/resource/:resource', updateMiddlewares, function(req,res,next){
    // some older version of agent keep updating state to this URL.
    if (req.user.credential==='agent') {
      controller.update_state.apply(controller, arguments);
    } else {
      controller.update.apply(controller, arguments);
    }
  });

  /**
   *
   * update single properties with custom behaviour
   *
   */
  server.patch(
    '/:customer/resource/:resource/alerts',
    middlewares.concat([
      router.requireCredential('admin'),
      router.resolve.idToEntity({param:'resource',required:true})
    ]),
    controller.update_alerts
  );

  server.patch('/:customer/resource/:resource/state',middlewares.concat([
    router.requireCredential('agent',{exactMatch:true}),
    router.resolve.idToEntity({param:'resource',required:true})
  ]),controller.update_state);

}

var controller = {
  /**
   *
   * @method GET
   *
   */
  get (req,res,next) {
    var resource = req.resource;
    Monitor
      .findOne({ resource: resource._id })
      .exec(function(err,monitor){
        var data = resource.toObject();
        data.monitor = monitor;
        res.send(200, data);
      });
  },
  /**
   *
   * @method GET
   *
   */
  fetch (req,res,next) {
    var filter = dbFilter(req.query,{
      sort: {
        fails_count: -1,
        type: 1 
      }
    })

    filter.where.customer_id = req.customer._id;
    if ( !ACL.hasAccessLevel(req.user.credential,'admin') ) {
      // find what this user can access
      filter.where.acl = req.user.email
    }

    ResourceManager.fetchBy(filter,(err,resources) => {
      if (err) {
        res.send(500,err)
      } else if (!Array.isArray(resources)) {
        res.send(503, new Error('resources not available'))
      } else {
        if (resources.length===0) {
          res.send(200,[])
        } else {
          var resource
          for (var i=0; i<resources.length; i++) {
            resource = resources[i]
            if (resource.monitor) {
              if (Array.isArray(resource.monitor.tags)) {
                resource.monitor.tags.push(resource.hostname);
              }
            }
          }
          res.send(200,resources)
        }
      }
    })
  },
  /**
   *
   * @method DELETE
   *
   */
  remove (req,res,next) {
    const resource = req.resource

    if (resource.type == 'host') {
      debug('removing host resource')
      ResourceManager.removeHostResource({
        resource: resource,
        user: req.user
      })
      res.send(200,{})
    } else {
      debug('removing resource')
      ResourceManager.remove({
        resource: resource,
        notifyAgents: true,
        user: req.user
      })
      res.send(200,{})
    }
  },
  /**
   *
   * @method POST
   *
   */
  create (req,res,next) {
    const customer = req.customer
    const body = req.body
    const hosts = body.hosts

    body.acl = req.acl;

    if (!hosts) {
      return res.send(400, [{
        field: 'hosts',
        message: 'a host is required',
        value: hosts,
        code: 'EREQ'
      }])
    }

    if (!Array.isArray(hosts)) hosts = [hosts]

    var params = MonitorManager.validateData(body)
    if (params.errors && params.errors.hasErrors()) {
      return res.send(400, params.errors)
    }

    var input = params.data
    input.user_id = req.user._id
    input.user_email = req.user.email
    input.customer = customer
    input.customer_id = customer.id
    input.customer_name = customer.name

    ResourceManager.createResourceOnHosts(hosts,input,function(error,results){
      if (error) {
        if (error.errors) {
          var messages=[];
          for(var err in error.errors){
            var e = errors[err];
            messages.push({
              field: e.path,
              type: e.kind
            });
          }

          return res.send(400, error.errors);
        } else {
          debug(error);
          return res.send(500, json.error('internal error', error));
        }
      } else {
        debug('resources created');
        return res.send(201, results);
      }
    });
  },
  /**
   *
   * @method PATCH
   *
   */
  update (req,res,next) {
    const resource = req.resource
    const body = req.body
    var updates

    body.host = req.host
    body.acl = req.acl

    const params = MonitorManager.validateData(body)
    if (params.errors && params.errors.hasErrors()) {
      return res.send(400, params.errors);
    }

    if (resource.type=='host') {
      updates = {
        acl: req.acl,
        tags: body.tags
      }
    } else {
      updates = params.data
    }

    const doUpdate = () => {
      ResourceManager.update({
        user_id: req.user._id,
        resource: resource,
        updates: updates
      },(error,resource) => {
        if (error) {
          res.send(500,json.error('update error',error.message));
        } else {
          res.send(200,resource);
        }
      })
    }

    if (updates.host_id) {
      Host.findById(updates.host_id, (err, host) => {
        if (err) return res.send(500,err)
        if (!host) return res.send(400,'invalid host')
        updates.host_id = host._id
        updates.host = host._id
        updates.hostname = host.hostname
        doUpdate()
      })
    } else {
      doUpdate()
    }


  },
  /**
   *
   * change the alert level
   * @author Facugon
   * @method PATCH
   * @route /:customer/resource/:id/alerts
   *
   */
  update_alerts (req, res, next) {
    var resource = req.resource;
    resource.alerts = req.params.alerts;
    resource.save(error => {
      if (error) res.send(500);
      else res.send(200, resource);
    });
  },
  /**
   *
   * @author Facugon
   * @method PATCH
   * @route /:customer/resource/:id/state
   *
   */
  update_state (req,res,next) {
    const resource = req.resource
    const input = req.params
    const state = req.params.state
    const manager = new ResourceManager(resource)
    input.last_update = new Date()

    manager.handleState(input,function(error){
      if (!error) {
        res.send(200,resource);
      } else {
        res.send(500,json.error('internal server error'));
      }
    });
  },
};
