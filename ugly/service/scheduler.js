"use strict";function Scheduler(){EventEmitter.call(this),this.agenda=new Agenda({mongo:mongodb,defaultConcurrency:50,maxConcurrency:200})}var Agenda=require("agenda"),config=require("config"),async=require("async"),format=require("util").format,ObjectId=require("mongoose").Types.ObjectId,EventEmitter=require("events").EventEmitter,util=require("util"),logger=require("../lib/logger")("eye::scheduler"),mongodb=require("../lib/mongodb").connection.db,Host=require("../entity/host").Entity,Task=require("../entity/task").Entity,Script=require("../entity/script").Entity,Customer=require("../entity/customer").Entity,User=require("../entity/user").Entity,JobDispatcher=require("./job");util.inherits(Scheduler,EventEmitter),Scheduler.prototype={setupAgenda:function(){function e(){logger.log("SIGTERM/SIGINT agenda graceful stop"),r.stop(function(){})}var t=this,r=this.agenda;r.define("task",function(e,r){logger.log("Called task job"),t.taskProcessor(e,r)}),r.on("start",function(e){logger.log("job %s started",e.attrs.name)}),r.on("error",function(e,t){logger.log("job %s error %j",t.name,e.stack)}),r.on("fail",function(e,t){logger.log("job %s failed %j",t.name,e.stack)}),process.on("SIGTERM",e),process.on("SIGINT",e)},initialize:function(e){var t=this;this.agenda.on("ready",function(){logger.log("scheduler is ready"),e(),t.setupAgenda()}),this.agenda.start()},scheduleTask:function(e,t){var r=e.task,o=e.customer,n=e.user,i=e.schedule,s={task_id:r._id,host_id:r.host_id,script_id:r.script_id,script_arguments:r.script_arguments,name:r.name,user_id:n._id,customer_id:o._id,customer_name:o.name,state:"new",notify:e.notify,scheduleData:i},a=new Date(i.runDate),c=i.repeatEvery||!1;this.schedule(a,"task",s,c,t)},schedule:function(e,t,r,o,n){var i=this.agenda.create(t,r);i.schedule(e),logger.log("agendaJob.schedule %s",e),o&&(logger.log("repeatEvery %s",o),i.repeatEvery(o)),i.save(n)},getTaskScheduleData:function(e,t){return e?void this.agenda.jobs({$and:[{name:"task"},{"data.task_id":e}]},t):t(new Error("task id must be provided"))},cancelTaskSchedule:function(e,t,r){return t?void this.agenda.cancel({$and:[{name:"task"},{_id:new ObjectId(t)}]},r):r(new Error("schedule id must be provided"))},taskProcessor:function(e,t){function r(r){e.fail(r),e.save(),t(r)}logger.log("////////////////////////////////////////"),logger.log("////////////////////////////////////////"),logger.log("Called agendaJob processor taskProcessor"),logger.log("////////////////////////////////////////"),logger.log("////////////////////////////////////////");var o=e.attrs.data;async.parallel({customer:function(e){return Customer.findById(o.customer_id,e)},task:function(e){return Task.findById(o.task_id,e)},host:function(e){return Host.findById(o.host_id,e)},user:function(e){return User.findById(o.user_id,e)},script:function(e){return Script.findById(o.script_id,e)}},function(n,i){if(n)return new r(n);var s=!1;return Object.keys(i).every(function(t,r){return!!i[t]||(s=!0,e.fail(t+" ("+o[t+"_id"]+") is missing"),e.save(),!1)}),s?t():void JobDispatcher.create({task:i.task,user:i.user,customer:i.customer,notify:!0},function(e,o){return e?new r(e):void t()})})}},module.exports=new Scheduler;