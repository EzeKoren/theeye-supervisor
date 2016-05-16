"use strict";

var debug = require('debug')('eye:supervisor:main');
debug('initializing supervisor');

process.on('SIGINT', function(){
  debug('supervisor process ends on "SIGINT"');
  process.exit(0);
});
process.on('SIGTERM', function(){
  debug('supervisor process ends on "SIGTERM"');
  process.exit(0);
});
process.on('uncaughtException', function(error){
  debug('supervisor process on "uncaughtException"');
  debug(error);
  //process.exit(0);
});
process.on('exit', function(){ // always that the process ends, throws this event
  debug('supervisor process ends on "process.exit"');
  process.exit(0);
});

require("./environment").setenv(
  process.env.NODE_ENV,
  function() {
    debug('initializing server');
    var server = require("./server");
    server.start();

    if( ! process.env.NO_MONITORING ) {
      debug('initializing monitor');
      var monitor = require('./service/monitor');
      monitor.start();
    }

    debug('supervisor is running');
  }
);
