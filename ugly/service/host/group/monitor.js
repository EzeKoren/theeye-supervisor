"use strict";function addMonitorInstancesToGroupHosts(e,t,r){logger.log("creating monitor instances on group hosts"),Resource.find({type:"host",template:t},function(t,o){if(0==o.length)return r();var n=lodash.after(o.length,function(){return r()});logger.log("creating %s monitors",o.length);for(var i=0;i<o.length;i++){var s=o[i];Host.findById(s.host_id,function(t,r){ResourceTemplateService.createMonitorFromTemplate({template:e,host:r,done:function(){logger.log("monitor created"),n(),AgentUpdateJob.create({host_id:r._id})}})})}})}function removeResourceTemplateInstancesFromGroupHosts(e,t){t||(t=function(){}),Resource.find(e).exec(function(e,r){if(e)return logger.error(e),t(e);if(!r||0==r.length)return logger.log("no resources were found"),t();for(var o=0;o<r.length;o++){var n=r[o];n.remove(function(e){if(e)return logger.error(e)})}t()})}var Resource=require("../../../entity/resource").Entity,Host=require("../../../entity/host").Entity,Monitor=require("../../../entity/monitor").Entity,AgentUpdateJob=require("../../../entity/job").AgentUpdate,logger=require("../../../lib/logger")("eye:service:group:monitor"),lodash=require("lodash"),ResourceTemplateService=require("../../../service/resource/template");exports.addTemplatesToGroup=function(e,t,r){r||(r=function(){});var o=lodash.after(t.length,function(){return r()});return t.forEach(function(t){e.addMonitorTemplate(t),addMonitorInstancesToGroupHosts(t.monitor_template,e,function(e){return o(e)})}),e.save(),this},exports.removeMonitorTemplateInstancesFromGroupHosts=function(e,t){t||(t=function(){}),logger.log("removing monitor instances"),removeResourceTemplateInstancesFromGroupHosts({template:e.template_resource},function(e){}),Monitor.find({template:e._id}).exec(function(e,r){function o(e){e.remove(function(t){return t?logger.error(t):void AgentUpdateJob.create({host_id:e.host_id})})}if(e)return logger.error(e),t(e);if(!r||0==r.length)return logger.log("no monitors were found"),t();for(var n=0;n<r.length;n++){var i=r[n];o(i)}t()})};