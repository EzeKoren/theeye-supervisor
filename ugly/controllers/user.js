"use strict";function UserInterface(e,t){var r=[],o=[];e.params.email?validate.isEmail(e.params.email)?o.push({param:"email",value:e.params.email}):r.push({param:"email",message:"invalid"}):r.push({param:"email",message:"required"}),e.params.credential?o.push({param:"credential",value:e.params.credential}):r.push({param:"credential",message:"required"});var n=e.customers;return n&&0!=n.length?o.push({param:"customers",value:n}):r.push({param:"customers",message:"at least one required"}),"undefined"!=typeof e.params.enabled&&o.push({param:"enabled",value:e.params.enabled}),e.params.client_id&&o.push({param:"client_id",value:e.params.client_id}),e.params.client_secret&&o.push({param:"client_secret",value:e.params.client_secret}),{errors:r,values:o,valueObject:function(){for(var e={},t=0;t<o.length;t++)e[o[t].param]=o[t].value;return e}}}var debug=require("../lib/logger")("eye:supervisor:controller:user"),json=require("../lib/jsonresponse"),strategys=require("../lib/auth/strategys"),_token=require("../lib/auth/token"),UserService=require("../service/user"),User=require("../entity/user").Entity,resolve=require("../router/param-resolver"),filter=require("../router/param-filter"),validate=require("../router/param-validator");module.exports=function(e,t){var t=strategys.setStrategy("basic");e.post("/token",[t.authenticate("basic",{session:!1})],controller.token),e.get("/user/:user",[t.authenticate("bearer",{session:!1}),function(e,t,r){return e.auth={user:e.user},r()},resolve.idToEntity({param:"user"})],controller.get),e.get("/user",[t.authenticate("bearer",{session:!1}),resolve.customerNameToEntity({param:"customer"})],controller.fetch),e.del("/user/:user",[t.authenticate("bearer",{session:!1}),resolve.idToEntity({param:"user"})],controller.remove),e.patch("/user/:user",[t.authenticate("bearer",{session:!1}),function(e,t,r){return e.auth={user:e.user},r()},resolve.idToEntity({param:"user"}),filter.spawn({param:"customers",filter:"toArray"}),filter.spawn({param:"customers",filter:"uniq"})],controller.patch),e.post("/user",[t.authenticate("bearer",{session:!1}),filter.spawn({param:"customers",filter:"toArray"}),filter.spawn({param:"customers",filter:"uniq"})],controller.create)};var controller={get:function(e,t,r){var o=e.user;return o?void o.publish({populateCustomers:!0},function(e,r){t.send(200,{user:r})}):t.send(404,json.error("user not found"))},patch:function(e,t,r){var o=e.user;if(!o)return t.send(404,json.error("user not found"));var n=new UserInterface(e,r),s=n.valueObject();return 0===n.values.length?t.send(400,json.error("nothing to update")):void UserService.update(o._id,s,function(e,r){return e?e.statusCode?t.send(e.statusCode,e.message):(debug.error(e),t.send(500,"internal error")):void r.publish({populateCustomers:!0},function(e,r){t.send(200,{user:r})})})},create:function(e,t,r){var o=new UserInterface(e,r);if(0!=o.errors.length)return t.send(400,json.error("invalid request",o.errors));var n=o.valueObject();UserService.create(n,function(e,r){return e?(debug.log("Error creating user"),debug.log(e),t.send(500,json.error("failed to create user")),void 0):(debug.log("new user created"),r.publish({populateCustomers:!0,publishSecret:!0},function(e,r){t.send(200,{user:r})}))})},fetch:function(e,t,r){var o=e.customer,n=e.params.credential,s={};o&&(s.customer_id=o.id),n&&(s.credential=n),UserService.findBy(s,function(e,r){if(!e){debug.log("users fetched");for(var o=[],s=0;s<r.length;s++){var i=r[s],a=n&&"agent"==n?{publishSecret:!0}:{},u=i.publish(a,function(e,t){});o.push(u)}return t.send(200,{users:o})}debug.error("error fetching users"),t.send(500,json.error("failed to fetch users"))})},token:function(e,t,r){var o=e.user;return _token.create(o.client_id,o.client_secret,function(e,r){return e?t.send(400,"Error"):(debug.log("creating new token"),void o.update({token:r.token,timestamp:r.timestamp},function(e){if(e)throw new Error("user token update fails");t.send(200,r.token)}))}),r},remove:function(e,t,r){var o=e.user;return o?void o.remove(function(e){return e?t.send(500,e):void t.send(204)}):t.send(404)}};