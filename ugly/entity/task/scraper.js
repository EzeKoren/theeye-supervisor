"use strict";var mongodb=require("../../lib/mongodb").db,ObjectId=require("mongoose").Schema.Types.ObjectId,TaskSchema=require("./index").TaskSchema,properties={url:{type:String,default:null,required:!0},method:{type:String,default:null,required:!0},external:{type:Boolean,default:null},timeout:{type:Number,default:null},body:{type:String,default:null},gzip:{type:Boolean,default:null},json:{type:Boolean,default:null},status_code:{type:Number,default:null},parser:{type:String,default:null},pattern:{type:String,default:null},type:{type:String,default:"scraper"}},EntitySchema=TaskSchema.extend(properties),Entity=mongodb.model("ScraperTask",EntitySchema);Entity.ensureIndexes(),exports.Entity=Entity;