"use strict";var fs=require("fs"),Script=require("../entity/script").Entity,ScriptService=require("../service/script"),json=require("../lib/jsonresponse"),debug=require("../lib/logger")("eye:supervisor:controller:script-download"),resolve=require("../router/param-resolver");module.exports=function(e,t){e.get("/:customer/script/:id/download",[t.authenticate("bearer",{session:!1}),resolve.customerNameToEntity({})],controller.get),e.get("/script/:id/download",[t.authenticate("bearer",{session:!1}),resolve.customerNameToEntity({})],controller.get)};var controller={get:function(e,t,r){var o=e.params.id;Script.findById(o,function(e,r){r?ScriptService.getScriptStream(r,function(e,o){e?(debug.error(e.message),t.send(500,json.error("internal error",null))):(debug.log("streaming script to client"),t.writeHead(200,{"Content-Disposition":"attachment; filename="+r.filename}),o.pipe(t))}):t.send(404,json.error("not found"))}),r()}};