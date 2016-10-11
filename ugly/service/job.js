"use strict";function ResultEvent(e){TaskEvent.findOne({emitter:e.task.id,enable:!0,name:e.state},function(e,t){return e?logger.error(e):t?void app.eventDispatcher.dispatch(t):logger.error(new Error("no events defined"))})}function registerJobOperation(e,t){t.populate([{path:"user"},{path:"host"}],function(r){var o={hostname:t.host.hostname,customer_name:t.customer_name,user_id:t.user._id,user_email:t.user.email,task_name:t.task.name,task_type:t.task.type,state:t.state};"ScraperJob"==t._type?(o.task_url=t.task.url,o.task_method=t.task.method,o.task_status_code=t.task.status_code,o.task_pattern=t.task.pattern):(o.script_name=t.script.filename,o.script_md5=t.script.md5,o.script_last_update=t.script.last_update,o.script_mimetype=t.script.mimetype),t.result&&(o.result=t.result),elastic.submit(t.customer_name,e,o)})}function createScriptJob(e,t){var r=e.task,o=r.script_id;Script.findById(o).exec(function(o,n){var i=new ScriptJob;i.task=r.toObject(),i.script=n.toObject(),i.task_id=r._id,i.script_id=n._id,i.user=e.user,i.user_id=e.user._id,i.host_id=r.host_id,i.host=r.host_id,i.name=r.name,i.customer_id=e.customer._id,i.customer_name=e.customer.name,i.notify=e.notify,i.state=STATE_NEW,i.event=e.event||null,i.save(function(e){if(e)return t(e);var r=globalconfig.elasticsearch.keys.task.execution;registerJobOperation(r,i),logger.log("script job created."),t(null,i)})})}function createScraperJob(e,t){var r=e.task,o=new ScraperJob;o.task=r.toObject(),o.task_id=r._id,o.user=e.user,o.user_id=e.user._id,o.host_id=r.host_id,o.host=r.host_id,o.name=r.name,o.customer_id=e.customer._id,o.customer_name=e.customer.name,o.notify=e.notify,o.state=STATE_NEW,o.event=e.event||null,o.save(function(e){if(e)return t(e);var r=globalconfig.elasticsearch.keys.task.execution;registerJobOperation(r,o),logger.log("scraper job created."),t(null,o)})}function ResultMail(e){var t=this;this.ScriptJob=function(e,t){var r,o,n,i=e.result;i&&(r=i.stdout?i.stdout.trim():"no stdout",o=i.stderr?i.stderr.trim():"no stderr",n=i.code||"no code");var s="<h3>Task "+e.task.name+" execution completed on "+e.host.hostname+".</h3><ul>\n    <li>stdout : "+r+"</li>\n    <li>stderr : "+o+"</li>\n    <li>code : "+n+"</li>\n    </ul>";NotificationService.sendEmailNotification({customer_name:e.customer_name,subject:"[TASK] "+e.task.name+" executed on "+e.host.hostname,content:s,to:t})},this.ScraperJob=function(e,t){var r="<h3>Task "+e.task.name+" execution completed on "+e.host.hostname+".</h3>";NotificationService.sendEmailNotification({customer_name:e.customer_name,subject:"[TASK] "+e.task.name+" executed on "+e.host.hostname,content:r,to:t})},app.customer.getAlertEmails(e.customer_name,function(r,o){e.populate([{path:"user"},{path:"host"}],function(r){t[e._type](e,o)})})}function CreationMail(e){var t="<h3>Task "+e.task.name+" will run on "+e.host.hostname+".</h3>";NotificationService.sendEmailNotification({customer_name:e.customer_name,subject:"[TASK] New "+e.task.name+" execution on "+e.host.hostname,content:t,to:e.user.email})}var JobModels=require("../entity/job"),Job=JobModels.Job,ScriptJob=JobModels.Script,ScraperJob=JobModels.Scraper,Script=require("../entity/script").Entity,TaskEvent=require("../entity/event").TaskEvent,EventDispatcher=require("./events"),async=require("async"),NotificationService=require("./notification"),globalconfig=require("config"),elastic=require("../lib/elastic"),logger=require("../lib/logger")("eye:jobs"),app=require("../app"),JOB_UPDATE_AGENT_CONFIG="agent:config:update",STATE_SUCCESS="success",STATE_FAILURE="failure",STATE_NEW="new",service={fetchBy:function(e,t){var r={};e.host&&(r.host_id=e.host._id),e.state&&(r.state=e.state),Job.find(r,function(e,r){t(r)})},getNextPendingJob:function(e,t){var r={};r.state=STATE_NEW,r.host_id=e.host._id,Job.findOne(r,function(e,r){null!=r?(r.state="sent",r.save(function(e){if(e)throw e;t(null,r)})):t(null,null)})},create:function(e,t){function r(e,r){e?t(e):t(null,r)}var o=e.task,n=o.type;"script"==n?createScriptJob(e,r):"scraper"==n?createScraperJob(e,r):t(new Error("invalid or undefined task type "+o.type))},update:function(e,t,r){if(e.state=t.state||STATE_FAILURE,e.result=t,e.save(function(t){return r(t,e)}),"agent:config:update"!=e.name){var o={topic:"jobs",subject:"job_update"};NotificationService.sendSNSNotification(e,o);var n=globalconfig.elasticsearch.keys.task.result;registerJobOperation(n,e),new ResultMail(e),new ResultEvent(e)}},sendJobCancelationEmail:function(e){var t=globalconfig.system.base_url+"/:customer/task/:task/schedule/:schedule",r=t.replace(":customer",e.customer_name).replace(":task",e.task_id).replace(":schedule",e.schedule_id),o="<h3>Task execution on "+e.hostname+"<small> Cancel notification</small></h3>\n    The task "+e.task_name+" will be executed on "+e.hostname+" at "+e.date+".<br/>\n    If you want to cancel the task you have "+e.grace_time_mins+' minutes.<br/>\n    <br/>\n    To cancel the Task <a href="'+r+'">press here</a> or copy/paste the following link in the browser of your preference : <br/>'+r+"<br/>.\n    ";NotificationService.sendEmailNotification({customer_name:e.customer_name,subject:"[TASK] Task "+e.task_name+" execution on "+e.hostname+" cancelation",content:o,to:e.to})},sendJobCanceledEmail:function(e){var t="<h3>Task execution on "+e.hostname+" canceled</h3>\n    The task "+e.task_name+" on host "+e.hostname+" at "+e.date+" has been canceled.<br/>";NotificationService.sendEmailNotification({customer_name:e.customer_name,subject:"[TASK] Task "+e.task_name+" execution on "+e.hostname+" canceled",content:t,to:e.to})}};module.exports=service;