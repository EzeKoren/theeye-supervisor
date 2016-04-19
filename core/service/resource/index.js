var util = require('util');
var events = require('events');
var logger = require('../../lib/logger')('eye:supervisor:service:resource');
var _ = require('lodash');

var ErrorHandler = require('../../lib/errorHandler');
var elastic = require('../../lib/elastic');
var CustomerService = require('../customer');
var NotificationService = require('../notification');
var ResourceSchema = require('../../entity/resource');
var Resource = ResourceSchema.Entity;
var ResourceStats = require('../../entity/resource/stats').Entity;
var ResourceMonitorSchema = require('../../entity/monitor');
var MonitorEntity = ResourceMonitorSchema.Entity;
var ResourceMonitorService = require('./monitor');
var Host = require('../../entity/host').Entity;
var Task = require('../../entity/task').Entity;
var HostStats = require('../../entity/host/stats').Entity;
var Job = require('../../entity/job').Entity;
var resourceNotification = require('./notification');

var filter = require('../../router/param-filter');

var Service = module.exports = function Service(resource) {
  this.resource = resource;
};

util.inherits(Service, events.EventEmitter);

Service.prototype.getConfig = function (done) {
  CustomerService.getCustomerConfig(this.resource.customer_id,
    function(error,config){
      done(config);
    });
}

Service.prototype._handleFailureState = function(input) {
  var self = this ;
  var newState = input.state;
  var customer_name = self.resource.customer_name ;
  logger.log('resource "%s" check fails.', self.resource.name);

  self.resource.fails_count++;
  self.getConfig(function(config) {
    logger.log(
      'resource %s fails count %s/%s', 
      self.resource.description, 
      self.resource.fails_count,
      config.fails_count_alert
    );

    if( self.resource.fails_count >= config.fails_count_alert ) {
      if( self.resource.state != newState ) { // current resource state
        logger.log('sending resource failure alerts to customer "%s"', self.resource.customer_name);
        self.logStateChange(input);
        self.resource.state = newState ;

        // resource failure require inmediate attention
        if( self.resource.attend_failure )
        {
          // trigger re-start action
          Host.findById(self.resource.host_id, function(error,host)
          {
            if( error ) {
              logger.log('Host for resource %s:%s not found',self.resource._id, self.resource.name);
            } else if( host != null && self.resource != null) {
              /**
               *  trigger defined action to handle this event
               */
              logger.log('not events defined nor auto-tasks implemented');
            } else {
              logger.log('invalid data error.');
              logger.log(host);
              logger.log(self.resource);
            }
          });
        }

        logger.log('preparing to send email notifications');
        var severity = self.getEventSeverity(input);
        self.resource.failure_severity = severity ;

        var subject = '[:priority] :resource failure'
          .replace(':resource', self.resource.name)
          .replace(':priority', severity)
          ;

        resourceNotification(self.resource, input.event, input.data,
          function(content){
            CustomerService.getAlertEmails(customer_name,function(emails){
              logger.log('sending email notifications');
              NotificationService.sendEmailNotification({
                'to': emails.join(','),
                'customer_name': customer_name,
                'subject': subject,
                'content': content
              });
            });
          }
        );

        NotificationService.sendSNSNotification({
          'state': 'failure',
          'data': input,
          'message': 'resource failure',
          'customer_name': customer_name,
          'resource': self.resource.name,
          'id': self.resource.id,
          'hostname': self.resource.hostname,
          'type': 'resource'
        },{
          topic : 'events' ,
          subject : 'resource_update'
        });
      }
    }
    else {
      if( self.resource.state == Resource.INITIAL_STATE ) {
        NotificationService.sendSNSNotification({
          'state' : 'failure',
          'data' : input ,
          'message' : 'resource failure',
          'customer_name' : customer_name,
          'resource' : self.resource.name,
          'id' : self.resource.id,
          'hostname' : self.resource.hostname,
          'type' : 'resource'
        },{
          topic : 'events' ,
          subject : 'resource_update' 
        });
      }
    }
    self.resource.save();
  });
}

Service.prototype._handleNormalState = function(input) {
  var self = this;
  var customer_name = self.resource.customer_name ;
  var newState = input.state;
  logger.log('resource "%s" normal', self.resource.name);

  self.getConfig(function(config)
  {
    var resource = self.resource ;
    // alerts sent ?
    if( resource.fails_count != 0 ) {
      if( resource.fails_count >= config.fails_count_alert ) {
        logger.log(
          'resource "%s" fails count %s/%s',
          resource.description,
          resource.fails_count,
          config.fails_count_alert
        );

        if( resource.state != newState ) // previous registered state
        {
          logger.log('resource "%s" restored', resource.name);
          self.logStateChange(input);
          resource.state = newState ;
          resource.fails_count = 0;
          resource.save();

          logger.log('sending resource restored alerts ' + customer_name);

          var content = 'resource ":description" recovered.'
            .replace(":description", resource.description);

          var severity = resource.failure_severity || 'undefined';
          self.resource.failure_severity = null ;

          var subject = '[:priority] :resource recovered'
          .replace(':resource', self.resource.name)
          .replace(':priority', severity)
          ;

          CustomerService.getAlertEmails(customer_name, function(emails){
            NotificationService.sendEmailNotification({
              to: emails.join(','),
              customer_name: customer_name,
              subject: subject,
              content: content
            });
          });

          NotificationService.sendSNSNotification({
            'state': newState,
            'message': 'resource normal',
            'customer_name': customer_name,
            'resource': resource.name,
            'id': resource.id,
            'hostname': resource.hostname
          },{
            topic : 'events' ,
            subject: 'resource_update'
          });
        }
      } else {
        resource.fails_count = 0;
        resource.save();
      }
    } else {
      if( resource.state != newState ) {
        if( resource.state == Resource.INITIAL_STATE ) {
          NotificationService.sendSNSNotification({
            'state' : newState,
            'message' : 'resource normal',
            'customer_name' : customer_name,
            'resource' : resource.name,
            'id' : resource.id,
            'hostname' : resource.hostname
          },{
            topic : 'events' ,
            subject : 'resource_update'
          });
        }
        resource.state = newState;
        resource.fails_count = 0;
        resource.save();
      }
    }
  });
}

Service.prototype._handleUpdatesStoppedState = function(input) {
  var newState = input.state;
  var self = this;
  var msg = 'resource ":name[:id]" notifications has stopped'
    .replace(":name",self.resource.name)
    .replace(":id",self.resource._id)
    ;
  var customer_name = self.resource.customer_name;
  logger.log(msg);

  self.resource.fails_count++;
  self.getConfig(function(config) {
    logger.log(
      'resource %s[%s] fails count %s/%s', 
      self.resource.description, 
      self.resource._id, 
      self.resource.fails_count,
      config.fails_count_alert
    );
    if( self.resource.fails_count >= config.fails_count_alert ) {
      if( self.resource.state != newState ) { // current resource state

        logger.log('resource "%s" updates stopped', self.resource.name);
        self.logStateChange(input);
        self.resource.state = newState ;

        var severity = self.getEventSeverity(input);
        self.resource.failure_severity = severity ;

        var subject = '[:priority] :resource unreachable'
          .replace(':resource', self.resource.name)
          .replace(':priority', severity)
          ;

        CustomerService.getAlertEmails(customer_name, function(emails){
          NotificationService.sendEmailNotification({
            to : emails.join(','),
            customer_name : customer_name,
            subject : subject,
            content : msg
          });
        });

        NotificationService.sendSNSNotification({
          'state': newState,
          'message': msg,
          'customer_name': customer_name,
          'resource': self.resource.name,
          'id': self.resource.id,
          'hostname': self.resource.hostname,
          'type': 'resource'
        },{
          'topic': 'events',
          'subject': 'resource_update'
        });

      }
    }
    self.resource.save();
  });
}

Service.prototype._handleStateError = function(input) {
  logger.log('resource "%s" state "%s" is unknown', this.resource.name, input.state);
}

Service.prototype.logStateChange = function(input) {
  var resource = this.resource;
  var data = {
    'date': (new Date()).toISOString(),
    'timestamp': (new Date()).getTime(),
    'state': input.state,
    'hostname': resource.hostname,
    'customer_name': resource.customer_name,
    'resource_id': resource._id,
    'resource_name': resource.name,
    'resource_type': resource.type,
    'type': 'resource-stats'
  };

  elastic.submit(resource.customer_name,'resource-stats', data);
}

Service.prototype.handleState = function(input,next) {
  var self = this ;

  switch(input.state)
  {
    case 'failure':
      input.last_update = Date.now();
      self._handleFailureState(input);
      break;
    case 'normal':
      input.last_update = Date.now();
      self._handleNormalState(input);
      break;
    case 'agent_stopped':
    case 'updates_stopped':
      self._handleUpdatesStoppedState(input);
      break;
    default:
      self._handleStateError(input);
      break;
  }

  if(input.last_update)
    self.resource.last_update = input.last_update;
  if(input.last_check)
    self.resource.last_check = input.last_check;

  self.resource.save();

  if(next) next();
}

Service.prototype.updateResource = function(input,next)
{
  var self = this;
  var resource = self.resource;
  var updates = {};

  if(input.host){
    input.host_id = input.host._id;
    input.hostname = input.host.hostname;
  }

  for(var propName in ResourceSchema.properties){
    if(input.hasOwnProperty(propName) && input[propName]){
      updates[propName] = input[propName];
    }
  }

  resource.update(updates, function(error){
    if(error) {
      logger.log('update error %j', error);
      return next(error);
    }

    MonitorEntity.findOne({
      'resource_id': resource._id
    },function(error,monitor){
      if(error) next(error);
      if(!monitor) next(new Error('resource monitor not found'), null);
      if(monitor){
        var previous_host = monitor.host_id;
        monitor.update(input, function(error){
          if(!error){
            Job.createAgentConfigUpdate(updates.host_id);
            // if monitor host changes, the new and the old agents should be notified
            if(previous_host != updates.host_id){
              logger.log('monitor host(%s) has changed. notifying agent', previous_host);
              Job.createAgentConfigUpdate(previous_host);
            }
          }
          else logger.log('monitor update error: %s', error);
          next(error);
        });
      }
    });
  });
}

Service.prototype.getEventSeverity = function(input) {
  var event = input.event;
  logger.log('resource event "%s"', event);
  if( event && /^host:stats:.*$/.test(event) ) {
    severity = 'Low';
  } else {
    severity = 'High';
  }
  return severity;
}

/**
 *
 * static methods
 *
 */
Service.fetchBy = function(input,next) {
  var query = { };
  query.enable = true;
  query.customer_id = input.customer._id;
  if( input.host ) query.host_id = input.host._id;
  if( input.type ) query.type = input.type;

  Resource
    .find(query)
    .sort({ 'fails_count':-1, 'type':1 })
    .exec(function(error,resources){
      if(error) {
        logger.log('unable to fetch resources from database');
        return next(error,null);
      }

      var pub = [];
      resources.forEach(function(resource,idx){
        resource.publish(function(error, data){
          pub.push(data); 
        });
      });

      next(null,pub);
    });
}

/**
 *
 * @author Facundo
 *
 */
Service.removeHostResource = function (resource) {
  var hid = resource.host_id;
  var rid = resource._id;

  logger.log('removing host "%s" resource "%s" resources', hid, rid);

  Host
    .findById(hid)
    .exec(function(err, item){
      item.remove(function(err){ });
    });

  logger.log('removing host stats');
  HostStats
    .find({ host_id: hid })
    .exec(function(err, items){
      if(items && items.length != 0) {
        for(var i=0; i<items.length; i++){
          items[i].remove(function(err){ });
        }
      }
    }
  );

  function removeResource(resource, done){
    Service.removeResourceMonitors(
      resource,
      false,
      function(err){
        if(err) return done(err);
        logger.log('removing host resource "%s"', resource.name);

        resource.remove(function(err){
          if(err) return done(err);
          logger.log('resource "%s" removed', resource.name);
          done();
        });
      }
    );
  }

  Resource
    .find({ 'host_id': hid })
    .exec(function(err, resources){
      if(resources.length != 0){

        var doneResourceRemoval = _.after(resources.length, function(){
          // all resource & monitors removed
        });

        for(var i=0; i<resources.length; i++){
          var resource = resources[i];
          removeResource(resource, function(){
            doneResourceRemoval();
          });
        }
      }
    });

  logger.log('removing host jobs history');
  Job
    .find({ host_id: hid })
    .exec(function(err, items){
      if(items && items.length != 0) {
        for(var i=0; i<items.length; i++){
          items[i].remove(function(err){ });
        }
      }
    });

  Task
    .find({ host_id: hid })
    .exec(function(err, items){
      if(items && items.length != 0) {
        for(var i=0; i<items.length; i++){
          items[i].host_id = null;
          items[i].save();
        }
      }
    });
}

/**
 *
 *
 */
function removeMonitor(monitor, done) {
  logger.log('removing monitor "%s" type "%s"', monitor.name, monitor.type);
  monitor.remove(function(err){
    if(err) return done(err);
    logger.log('monitor %s removed', monitor.name);
    done();
  });
}

/**
 *
 * @author Facundo
 *
 */
Service.removeResourceMonitors = function (resource, notifyAgent, next) {
  logger.log('removing resource "%s" monitors', resource.name);

	MonitorEntity.find({
		'resource_id': resource._id
	},function(error,monitors){

		if(monitors.length !== 0) {
      var doneMonitorsRemoval = _.after(monitors.length, function(){
        if(notifyAgent) {
          Job.createAgentConfigUpdate(monitor.host_id);
        }
      });

      for(var i=0; i<monitors.length; i++) {
        var monitor = monitors[i];
        removeMonitor(monitor, function(err){
          doneMonitorsRemoval();
        });
      }

      next(null);
		} else {
      logger.log('no monitors found. skipping');
      next(null);
    }
	});
}

/**
 *
 * @return {object ErrorHandler}
 *
 */
Service.setResourceMonitorData = function(input,done) {
  var errors = new ErrorHandler;

  if( !input.monitor_type ) errors.required('monitor_type');
  if( !input.looptime ) errors.required('looptime');

  var data = {
    'monitor_type': input.monitor_type,
    'name': input.name || input.description,
    'description': input.description || input.name,
    'type': input.type || input.monitor_type,
    'looptime': input.looptime
  };

  logger.log('setting up resource type & properties');
  switch(input.monitor_type)
  {
    case 'scraper':
      data.url = input.url || errors.required('url');
      data.external_host_id = input.external_host_id;
      data.pattern = input.pattern || errors.required('pattern');
      data.timeout = input.timeout || 10000;
      break;
    case 'process':
      data.pattern = input.pattern || errors.required('pattern');
      data.psargs = input.psargs || 'aux';
      break;
    case 'script':
      data.script_id = input.script_id || errors.required('script_id');
      var scriptArgs = filter.toArray(input.script_arguments);
      data.script_arguments = scriptArgs;
      break;
  }

  var error = errors.hasErrors() ? errors : null;

  done ? done(error, data) : null;

  return {
    data: data,
    error: error
  }
}

Service.disableResourcesByCustomer = function(customer, doneFn){
  Resource
    .find({ 'customer_id': customer._id })
    .exec(function(error, resources){
      if(resources.length != 0){
        for(var i=0; i<resources.length; i++){
          var resource = resources[i];

          resource.enable = false;
          resource.save(function(error){
            if(error) {
              logger.log('ERROR updating resource property');
              throw error;
            }
          });
        }
      }
    });
}

/**
 *
 * API to create multiple resource and monitor linked to a host
 * @author Facundo
 *
 */
Service.createManyResourcesMonitor = function(input, doneFn) {
  logger.log('preparing to create resources');
  logger.log(input);
  var hosts = input.hosts;
  var errors = null;
  var monitors = [];

  var completed = _.after(hosts.length, function(){
    logger.log('all hosts processed');
    doneFn(errors, monitors);
  });

  var hostProcessed = function(hostId, error, data){
    if(error){
      errors = errors || {};
      logger.log('there are some error %o', error);
      errors[ hostId ] = error.message;
    } else {
      logger.log('host resource and monitor created');
      monitors.push( data );
    }

    completed();
  }

  for(var i=0; i<hosts.length; i++) {
    var hostId = hosts[i];
    handleHostIdAndData(hostId, input, function(error, result){
      hostProcessed(hosts[i], error, result);
    });
  }
}

/**
 *
 *
 * @author Facundo
 *
 */
function handleHostIdAndData(hostId, input, doneFn){
  Host.findById(hostId, function(err,host){
    if(err) return doneFn(err);

    if(!host) {
      var e = new Error('invalid host id ' + hostId);
      e.statusCode = 400;
      return doneFn(e);
    }

    input.host_id = host._id;
    input.hostname = host.hostname;

    createResourceAndMonitorForHost(input, doneFn);
  });
}

/**
 *
 * set data and create entities
 *
 */
function createResourceAndMonitorForHost (input, next) {
  logger.log('creating resource for host %s', input.hostname);
  var resource_data = {
    'host_id' : input.host_id,
    'hostname' : input.hostname,
    'customer_id' : input.customer_id,
    'customer_name' : input.customer_name,
    'name' : input.name,
    'type' : ResourceMonitorService.setType(input.type, input.monitor_type),
    'description' : input.description
  }

  ResourceMonitorService.setMonitorData(
    input.monitor_type,
    input,
    function(error,monitor_data){
      if(error) return next(error);
      else if(!monitor_data) {
        var e = new Error('invalid resource data');
        e.statusCode = 400;
        return next(e);
      }

      createResourceAndMonitor({
        resource_data: resource_data,
        monitor_data: monitor_data
      }, next);
    });
}

/**
 *
 * create entities
 *
 */
function createResourceAndMonitor(input, done){
  var monitor_data = input.monitor_data;
  var resource_data = input.resource_data;

  logger.log('creating resource');
  Resource.create(resource_data, function(err,resource){
    if(err) throw err;
    else {
      logger.log('creating resource %s monitor', resource._id);
      logger.log(monitor_data);

      // monitor.resource is used to populate the entity. need refactor
      monitor_data.resource = resource._id;
      monitor_data.resource_id = resource._id;

      MonitorEntity.create(
        monitor_data,
        function(err, monitor){
          if(err) throw err;

          Job.createAgentConfigUpdate(monitor.host_id);

          logger.log('resource & monitor created');
          return done(null,{
            'resource': resource, 
            'monitor': monitor 
          });
        }
      );
    }
  });
}

/**
 *
 * @author Facundo
 * @param {Object} script, a script entity
 * @return null
 *
 */
function updateMonitorsWithDeletedScript (script,done)
{
  done=done||function(){};

  logger.log('searching script "%s" resource-monitor', script._id);
  var query = { 'type': 'script', 'script': script._id };
  var options = { 'populate': true };

  ResourceMonitorService.findBy(
    query,
    options,
    function(error, monitors){
      if(!monitors||monitors.length==0){
        logger.log('no monitores linked to the script found.');
        return done();
      }

      for(var i=0; i<monitors.length; i++) {
        var monitor = monitors[i];
        detachMonitorScript (monitor);
      }
    }
  );
}

function detachMonitorScript (monitor, done)
{
  done=done||function(){};
  if(!monitor.resource._id) {
    var err = new Error('populate monitor first. resource object required');
    logger.error(err);
    return done(err);
  }

  var resource = monitor.resource;
  resource.enable = false;
  resource.save(function(error){
    if(error) return logger.error(error);
    monitor.enable = false;
    monitor.config.script_id = null;
    monitor.config.script_arguments = [];
    monitor.save(function(error){
      if(error) return logger.error(error);
      logger.log('monitor changes saved');
      logger.log('notifying "%s"', monitor.host_id);
      Job.createAgentConfigUpdate(monitor.host_id);
    });
  });
}

/**
*
* search script-monitor and create a notify job to the monitor agents.
*
* @author Facundo
* @param {Object} script, a script entity
* @return null
*
*/
function notifyScriptMonitorsUpdate (script) {
  var query = {
    'type':'script',
    'script':script._id
  };
  ResourceMonitorService.findBy(query,function(error, monitors){
    if(!monitors||monitors.length==0){
      logger.log('no monitors with this script attached found.');
      return;
    }

    var hosts = [];
    // create one notification for each host
    for(var i=0; i<monitors.length; i++){
      var monitor = monitors[i];
      if( hosts.indexOf(monitor.host_id) === -1 ){
        hosts.push(monitor.host_id);
      }
    }

    for(var i=0;i<hosts.length;i++){
      var host = hosts[i];
      logger.log('notifying host "%s"', host);
      Job.createAgentConfigUpdate(host);
    }
  });
}

Service.onScriptRemoved = function (script) {
  updateMonitorsWithDeletedScript(script);
}

Service.onScriptUpdated = function(script){
  notifyScriptMonitorsUpdate(script);
}
