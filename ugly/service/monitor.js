"use strict";function checkResourcesState(e){logger.log("***** CHECKING RESOURCES STATUS *****"),Resource.find({enable:!0}).exec(function(t,r){var o=r.length;logger.log("running %s checks",o);var n=lodash.after(o,function(){logger.log("releasing monitoring job"),e()});r.forEach(function(e){runChecks(e,function(){return n()})})})}function runChecks(e,t){CustomerService.getCustomerConfig(e.customer_id,function(r,o){if(r)return logger.error("customer %s configuration fetch failed",e.customer_name),t();if(!o)return logger.error("customer %s configuration not found",e.customer_name),t();switch(e.type){case"host":checkHostResourceStatus(e,t);break;case"script":case"scraper":case"process":case"dstat":case"psaux":checkResourceMonitorStatus(e,o,t);break;case"default":logger.error("unhandled resource %s",e.type),t()}})}function checkResourceMonitorStatus(e,t,r){r||(r=function(){}),ResourceMonitor.findOne({enable:!0,resource_id:e._id},function(o,n){if(o)return logger.error("Resource monitor query error : %s",o.message),r();if(!n)return logger.log("resource has not got any monitor"),r();logger.log('checking monitor "%s"',e.name);var s=e.last_update.getTime();validLastupdate({loop_duration:n.looptime,loop_threshold:t.resources_alert_failure_threshold_milliseconds,last_update:s,fails_count:e.fails_count},function(t,o,n){if(!o){var s=new ResourceService(e);s.handleState({state:Constants.RESOURCE_STOPPED,last_check:Date.now()})}r()})})}function checkHostResourceStatus(e,t){t||(t=function(){}),logger.log("checking host resource %s",e.name),validLastupdate({loop_duration:config.get("agent").core_workers.host_ping.looptime,loop_threshold:config.get("monitor").resources_alert_failure_threshold_milliseconds,last_update:e.last_update.getTime(),fails_count:e.fails_count},function(r,o,n){if(!o){var s=new ResourceService(e);s.handleState({state:Constants.RESOURCE_STOPPED,last_check:Date.now()})}t()})}function validLastupdate(e,t){t||(t=function(){}),logger.log(e);var r,o=Date.now(),n=e.loop_duration,s=e.loop_threshold,i=e.fails_count,a=e.last_update,c=o-a,u=n+s,l=Math.floor(c/1e3/60);logger.log("last update time elapsed "+l+" minutes");var g=Math.floor(c/n);logger.log("failed loops count %s",g),c>u?g>i?(logger.log("last update check failed %s times",g),t(null,r=!1,g)):t(null,r=!0,g):t(null,r=!0)}var config=require("config"),lodash=require("lodash"),Resource=require("../entity/resource").Entity,ResourceMonitor=require("../entity/monitor").Entity,Host=require("../entity/host").Entity,ResourceService=require("./resource"),CustomerService=require("./customer"),HostService=require("./host"),logger=require("../lib/logger")("eye::monitor"),Constants=require("../constants/monitors"),Scheduler=require("../service/scheduler");module.exports={start:function(){var e=config.get("monitor"),t=e.resources_check_failure_interval_milliseconds/1e3;Scheduler.agenda.define("monitoring",{lockLifetime:3e5},function(e,t){checkResourcesState(t)}),Scheduler.agenda.every(t+" seconds","monitoring"),logger.log("monitoring started")}};