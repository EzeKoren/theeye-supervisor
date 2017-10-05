'use strict'

const LIFECYCLE = require('../constants/lifecycle')
var Agenda = require('agenda');
// var config = require('config');
var async = require('async');
// var format = require('util').format;
var ObjectId = require('mongoose').Types.ObjectId;
var EventEmitter = require('events').EventEmitter;
var util = require('util');

var logger = require('../lib/logger')(':scheduler');
var mongodb = require('../lib/mongodb').connection.db;
var Host = require('../entity/host').Entity;
var Task = require('../entity/task').Entity;
var Script = require('../entity/file').Script;
var Customer = require('../entity/customer').Entity;
var User = require('../entity/user').Entity;
var JobDispatcher = require('./job');

function Scheduler() {

  EventEmitter.call(this);

  // use the default mongodb connection
  this.agenda = new Agenda({
    mongo: mongodb,
    defaultConcurrency: 50,
    maxConcurrency: 200
  });
}


// give the scheduler the hability to emit events
util.inherits(Scheduler, EventEmitter);


Scheduler.prototype = {
  initialize: function(ready) {
    var self = this;
    this.agenda.on('ready', function(){
      logger.log('scheduler is ready');
      ready();
      self.setupAgenda();
    });
    this.agenda.start();
  },
  setupAgenda: function(){
    var self = this;
    var agenda = this.agenda;

    agenda.define('task', function(job, done) {
      logger.log('Called task job');
      self.taskProcessor(job, done);
    });

    agenda.on('start', function(job) {
      logger.log('job %s started', job.attrs.name);
    });

    agenda.on('complete', function(job) {
      logger.log('job %s completed', job.attrs.name);
      //TODO nice place to check for schedules and ensure tag
    });

    agenda.on('error', function(err, job) {
      logger.log('job %s error %j', job.name, err.stack);
    });

    agenda.on('fail', function(err, job) {
      logger.log('job %s failed %j', job.name, err.stack);
    });

    // Unlock agenda events when process finishes
    function graceful() {
      logger.log('SIGTERM/SIGINT agenda graceful stop');
      agenda.stop(function(){});
      // process.exit(0);
    }

    process.on('SIGTERM', graceful);
    process.on('SIGINT', graceful);
  },
  /**
   * schedules a task
   * @param {Object} task data.
   */
  scheduleTask: function(input, done) {
    var task = input.task,
      customer = input.customer,
      user = input.user,
      schedule = input.schedule;

    const data = {
      task_id: task._id ,
      host_id: task.host_id ,
      script_id: task.script_id ,
      script_arguments: task.script_arguments ,
      name: task.name ,
      user_id: user._id ,
      customer_id: customer._id ,
      customer_name: customer.name ,
      lifecycle: LIFECYCLE.READY,
      notify: input.notify ,
      scheduleData: schedule
    }

    // runDate is miliseconds
    var date = new Date(schedule.runDate);
    var frequency = schedule.repeatEvery || false;

    var self = this;
    this.schedule(date,"task",data,frequency, function(err,job){
      if(err) return done(err);
      done(null,job);
      // If everything went well, ensure 'scheduled' tag on the task
      self.tagThatTask(task,function(){});
    });
  },
  /*
  * Given a task, this method will ensure it has a 'scheduled' tag
  */
  tagThatTask: function(task, callback) {
    var tags = [].concat(task.tags);

    if (tags.indexOf("scheduled") === -1) {
      tags.push("scheduled");
      task.update({tags:tags}, callback);
    } else {
      callback();
    }
  },
  // When untaggin we only got ID, find and check
  untagTask: function(task, callback) {
    var tags = [].concat(task.tags);

    if(tags.indexOf("scheduled") !== -1) {
      tags.splice(tags.indexOf("scheduled"),1);
      task.update({tags:tags}, callback);
    }else{
      callback();
    }
  },
  handleScheduledTag: function(task, callback) {
    if(!task) {
      var err = new Error('Missing task');
      err.statusCode = 400;
      return callback(err);
    }

    var self = this;
    this.taskSchedulesCount(task, function (err, count) {
      if (err) return callback(err);
      if (count) { //has schedules
        self.tagThatTask(task, callback);
      } else {
        self.untagTask(task, callback);
      }
    });
  },
  /**
   * Schedules a job for its starting date and parsing its properties
   */
  schedule: function(starting, jobName, data, interval, done) {
    var agendaJob = this.agenda.create(jobName, data);
    agendaJob.schedule(starting);
    logger.log("agendaJob.schedule %s", starting);
    if (interval) {
      logger.log("repeatEvery %s", interval);
      agendaJob.repeatEvery(interval);
    }
    agendaJob.save(done);
  },
  getTaskScheduleData: function(oid, callback) {
    if(!oid) {
      return callback(new Error('task id must be provided'));
    }
    this.agenda.jobs(
      {
        $and:[
          {name: 'task'},
          {'data.task_id': oid}
        ]
      },
      callback);
  },
  // searches for task jobs of a given customer id
  // TODO method naming could be improved if it's not gonna be a generic getter
  getSchedules: function(cid, callback) {
    if(!cid) {
      return callback(new Error('user id must be provided'));
    }
    this.agenda.jobs(
      {
        $and:[
          {name: 'task'},
          {'data.customer_id': cid}
        ]
      },
      callback);
  },

  // Counts schedules for the given task
  // @param callback: Function (err, schedulesCount)
  taskSchedulesCount: function(task, callback) {
    this.getTaskScheduleData(task._id, function(err, schedules){
      return callback(err, err ? 0 : schedules.length);
    });
  },

  //Cancels a specific scheduleId. Task is provided for further processing
  cancelTaskSchedule: function(task, scheduleId, callback) {
    if(!scheduleId) return callback(new Error('schedule id must be provided'));

    var self = this;
    // la verdad es que con el schedule id alcanza
    this.agenda.cancel({
      $and:[
        {name: 'task'},
        {_id: new ObjectId(scheduleId)}
      ]
    }, function(err, numRemoved){
      if(err) return callback(err);
      callback();
      // numRemoved is lost through the callbacks, don't count on it
      self.handleScheduledTag(task,function(){});
    });
  },

  // deletes ALL schedules for a given task
  unscheduleTask: function (task, callback) {
    this.agenda.cancel({
      $and: [
        { name: 'task' },
        { "data.task_id": task._id }
      ]
    }, callback);
  },

  taskProcessor: function(agendaJob, done) {
    logger.log('////////////////////////////////////////');
    logger.log('////////////////////////////////////////');
    logger.log('Called agendaJob processor taskProcessor');
    logger.log('////////////////////////////////////////');
    logger.log('////////////////////////////////////////');

    var jobData = agendaJob.attrs.data;

    function JobError (err){
      agendaJob.fail(err);
      agendaJob.save();
      done(err);
    }

    async.parallel({
      customer: callback => Customer.findById(jobData.customer_id, callback) ,
      task: callback => Task.findById(jobData.task_id, callback) ,
      host: callback => Host.findById(jobData.host_id, callback) ,
      user: callback => User.findById(jobData.user_id, callback) ,
      script: callback => Script.findById(jobData.script_id, callback)
    }, function(err, data) {
      if(err) return new JobError(err);

      var failed = false;
      Object.keys(data).every(function(k,i){
        //if any member isn't here: fail and done.
        if(!data[k]) {
          failed = true;
          agendaJob.fail(k + ' (' + jobData[k+'_id'] +') is missing');
          agendaJob.save();
          return false;
        }
        return true;
      });

      if(failed) return done();

      JobDispatcher.create({
        task: data.task,
        user: data.user,
        customer: data.customer,
        notify: true
      },(err,job)=>{
        if(err) return new JobError(err);
        done();
      });
    });
  }
};

module.exports = new Scheduler();
