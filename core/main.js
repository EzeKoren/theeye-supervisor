'use strict';

var ErrorHandler = require('./lib/error-handler');
require('./lib/error-extend');

var logger = require('./lib/logger')('main');
logger.log('initializing supervisor');

process.on('SIGINT', function(){
  logger.log('supervisor process ends on "SIGINT"');
  process.exit(0);
});

process.on('SIGTERM', function(){
  logger.log('supervisor process ends on "SIGTERM"');
  process.exit(0);
});

process.on('exit', function(){ // always that the process ends, throws this event
  logger.log('supervisor process ends on "process.exit"');
  process.exit(0);
});

process.on('uncaughtException', function(error){
  logger.error('supervisor process on "uncaughtException"');
  logger.error(error);

  var handler = new ErrorHandler();
  handler.sendExceptionAlert(error);
});

logger.log('setting environment');
require('./environment').setenv(function(){

  logger.log('connecting mongo db');
  require('./lib/mongodb').connect(function(){

    logger.log('initializing scheduler');
    var scheduler = require('./service/scheduler');
    scheduler.initialize(function(){

      logger.log('initializing events dispatcher');
      var dispatcher = require('./service/events');
      dispatcher.initialize(function(){

        var config = require('config');
        if (config.monitor.enabled!==false) {
          logger.log('initializing monitor');
          var monitor = require('./service/monitor');
          monitor.start();
        } else {
          logger.log('WARNING ! Monitoring service is disabled by config');
        }

        logger.log('initializing server');
        var app = require('./app');

        app.jobDispatcher = require('./service/job');
        app.eventDispatcher = dispatcher;
        app.scheduler = scheduler;
        app.customer = require('./service/customer');

        app.start();

        logger.log('supervisor is running');
      });
    });
  });
});
