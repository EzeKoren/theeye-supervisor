"use strict";function registerCRUDOperation(e,t){var r=config.elasticsearch.keys.template.task.crud;elastic.submit(e,r,t)}function validateRequest(e,t){return e.group?e.tasktemplate?e.group.hasTaskTemplate(e.tasktemplate)?void 0:t.send(400,"task template does not belong to the group"):t.send(404,"task template not found"):t.send(404,"group not found")}function removeTaskTemplateInstancesFromHostGroups(e,t){t||(t=function(){});var r={template:e._id};Task.find(r).exec(function(e,r){if(e)return logger.error(e),t(e);if(!r||0==r.length)return logger.log("tasks not found"),t();for(var o=0;o<r.length;o++){var n=r[o];n.remove(function(e){return e?logger.error(e):void AgentUpdateJob.create({host_id:n.host_id})})}t()})}function addTaskTemplateInstancesToGroupHosts(e,t,r,o){Resource.find({type:"host",template:r},function(r,o){logger.log(o);for(var n=0;n<o.length;n++){var i=o[n];Host.findById(i.host_id,function(r,o){TaskService.createFromTemplate({customer:t,templateData:e.toObject(),host:o,done:function(e,t){AgentUpdateJob.create({host_id:o._id})}})})}})}function updateTaskInstancesOnHostGroups(e,t){t||(t=function(){});var r={template:e._id};Task.find(r).exec(function(r,o){if(r)return logger.error(r),t(r);if(!o||0==o.length)return logger.log("tasks not found"),t();for(var n=0;n<o.length;n++){var i=o[n];i.update(e.values(),function(e){return e?logger.error(e):void AgentUpdateJob.create({host_id:i.host_id})})}t()})}var resolver=require("../router/param-resolver"),validator=require("../router/param-validator"),logger=require("../lib/logger")("eye:controller:template:task"),TaskService=require("../service/task"),Task=require("../entity/task").Entity,Resource=require("../entity/resource").Entity,Host=require("../entity/host").Entity,config=require("config"),elastic=require("../lib/elastic"),Job=require("../entity/job").Job,AgentUpdateJob=require("../entity/job").AgentUpdate;module.exports=function(e,t){e.get("/:customer/hostgroup/:group/tasktemplate/:tasktemplate",[t.authenticate("bearer",{session:!1}),resolver.customerNameToEntity({}),resolver.idToEntity({param:"group",entity:"host/group"}),resolver.idToEntity({param:"tasktemplate",entity:"task/template"})],controller.get),e.del("/:customer/hostgroup/:group/tasktemplate/:tasktemplate",[t.authenticate("bearer",{session:!1}),resolver.customerNameToEntity({}),resolver.idToEntity({param:"group",entity:"host/group"}),resolver.idToEntity({param:"tasktemplate",entity:"task/template"})],controller.remove),e.put("/:customer/hostgroup/:group/tasktemplate/:tasktemplate",[t.authenticate("bearer",{session:!1}),resolver.customerNameToEntity({}),resolver.idToEntity({param:"group",entity:"host/group"}),resolver.idToEntity({param:"tasktemplate",entity:"task/template"})],controller.replace),e.get("/:customer/hostgroup/:group/tasktemplate",[t.authenticate("bearer",{session:!1}),resolver.customerNameToEntity({}),resolver.idToEntity({param:"group",entity:"host/group"})],controller.fetch),e.post("/:customer/hostgroup/:group/tasktemplate",[t.authenticate("bearer",{session:!1}),resolver.customerNameToEntity({}),resolver.idToEntity({param:"group",entity:"host/group"})],controller.create)};var controller={get:function(e,t,r){validateRequest(e,t);var o=e.tasktemplate;o.publish(function(e){t.send(200,{task:e})})},fetch:function(e,t,r){if(!e.group)return t.send(404,"group not found");var o=e.group;o.publish({},function(e,r){var o=r.tasks;t.send(200,{tasks:o})})},create:function(e,t,r){function o(e,t,r){e.task_templates.push(t),e.save(function(o){return o&&logger.error(o),logger.log("task added to group"),addTaskTemplateInstancesToGroupHosts(t,i,e,function(e){}),r(o,t)})}if(!e.group)return t.send(404,"group not found");if(!e.body.task)return t.send(400,"tasks required");var n=e.group,i=e.customer,s=[e.body.task];TaskService.tasksToTemplates(s,e.customer,e.user,function(r,i){if(r)return t.send(r.statusCode,r.message);var s=i[0];registerCRUDOperation(e.customer.name,{template:n.hostname_regex,name:s.name,customer_name:e.customer.name,user_id:e.user.id,user_email:e.user.email,operation:"create"}),o(n,s,function(e){return e?t.send(500):void t.send(200,{task:s})})})},replace:function(e,t,r){if(validateRequest(e,t),!e.group)return t.send(404,"group not found");if(!e.tasktemplate)return t.send(404,"task not found");if(!e.body.task)return t.send(400,"invalid request. body task required");var o=e.group,n=e.tasktemplate,i=e.body.task;n.update(i,function(r){return r?t.send(500):(updateTaskInstancesOnHostGroups(n,function(e){logger.log("all tasks updated")}),registerCRUDOperation(e.customer.name,{template:o.hostname_regex,name:n.name,customer_name:e.customer.name,user_id:e.user.id,user_email:e.user.email,operation:"update"}),void n.publish(function(e){t.send(200,{task:e})}))})},remove:function(e,t,r){validateRequest(e,t);var o=e.tasktemplate,n=e.group;removeTaskTemplateInstancesFromHostGroups(o,function(r){r&&t.send(500),o.remove(function(r){r&&t.send(500),registerCRUDOperation(e.customer.name,{template:n.hostname_regex,name:o.name,customer_name:e.customer.name,user_id:e.user.id,user_email:e.user.email,operation:"delete"}),n.detachTaskTemplate(o),t.send(200)})})}};