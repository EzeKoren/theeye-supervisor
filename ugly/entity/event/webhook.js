"use strict";var Schema=require("mongoose").Schema,mongodb=require("../../lib/mongodb").db,BaseSchema=require("./schema"),EventSchema=new BaseSchema({emitter:{type:Schema.Types.ObjectId,ref:"Webhook",default:null}});module.exports=EventSchema;