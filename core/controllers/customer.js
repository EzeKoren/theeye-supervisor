'use strict';

const lodash = require('lodash');
var logger = require('../lib/logger')('controller:customer');
var json = require('../lib/jsonresponse');
var router = require('../router');

var CustomerService = require('../service/customer');
var UserService = require('../service/user');
var ResourceService = require('../service/resource');
var HostService = require('../service/host');

module.exports = function (server, passport) {
  var middlewares = [
    passport.authenticate('bearer', {session:false}),
    router.requireCredential('root'),
    router.resolve.idToEntity({param:'customer',required:true}),
    router.ensureCustomer,
  ];

  // users can fetch its own current customer information
  server.get('/:customer/customer',[
    passport.authenticate('bearer', {session:false}),
    router.resolve.customerNameToEntity({required:true}),
    router.ensureCustomer
  ],controller.get);

  server.get('/customer/:customer',middlewares,controller.get);
  //server.put('/customer/:customer',middlewares,controller.replace);
  server.del('/customer/:customer',middlewares,controller.remove);
  server.patch('/customer/:customer',middlewares,controller.patch);

  server.get('/customer',[
    passport.authenticate('bearer',{session:false}),
    router.requireCredential('root'),
  ],controller.fetch);

  server.post('/customer',[
    passport.authenticate('bearer',{session:false}),
    router.requireCredential('root'),
  ],controller.create);
}

var controller = {
  /**
   *
   */
  get (req,res,next) {
    res.send(200, req.customer.publish());
  },
  /**
   *
   */
  fetch (req,res,next) {
    CustomerService.fetch({}, function(error,customers) {
      if(error) {
        logger.error('error fetching customers');
        res.send(500, json.error('failed to fetch customers'));
      } else {
        var published = [];

        for(var c=0;c<customers.length;c++)
          published.push( customers[c].publish() );
          
        return res.send(200, customers.map(customer => customer.publish()) );
      }
    });
  },
  /**
   *
   */
  create (req,res,next) {
    var input = req.body;

    if(!input.name) return res.send(400, json.error('name is required'));
    if(!input.email) return res.send(400, json.error('email is required'));

    CustomerService.create(input, function(error,customer) {
      if(error) {
        if(error.code == 11000) { //duplicated
          res.send(400, json.error(input.name + ' customer already exists'));
        } else {
          logger.log(error);
          res.send(500, json.error('failed to create customer'));
        }
      } else {
        logger.log('new customer created');

        UserService.create({
          email: customer.name + '-agent@theeye.io',
          customers: [ customer.name ],
          credential: 'agent',
          enabled: true
        }, function(error, user) {
          if(error) {
            logger.error('creating user agent for customer');
            logger.error(error);

            customer.remove(function(e){
              if(e) return logger.error(e);
              logger.log('customer %s removed', customer.name);
            });

            if(error.code == 11000) { //duplicated
              res.send(400, json.error('customer user agent already registered'));
            } else {
              logger.log(error);
              res.send(500, json.error('failed to create user agent'));
            }
          } else {
            logger.log('user agent created');

            customer.agent = user;

            return res.send(201, customer);
          } 
        });
      }
    });
  },
  /**
   * @method PATCH
   *
   * @route /customer/:customer
   */
  patch (req, res, next) {
    var customer = req.customer;
    var updates = req.params;

    if (updates.description) { customer.description = updates.description; }
    if (Array.isArray(updates.emails)) { customer.emails = updates.emails; }
    if (updates.config) {
      var config = lodash.merge({},customer.config,updates.config);
      customer.config = config;
    }

    customer.save( (err,model) => {
      if (err) {
        res.send(500,err);
      } else {
        res.send(200, customer);
      }
      next();
    });
  },
  /**
   *
   * mantein the same customer ,
   * but replace the customer properties values with the data provided.
   *
   * @author Facundo
   * @method PUT
   * @route /customer/:customer
   */
  //replace (req, res, next) {
  //  var customer = req.customer;
  //  var updates = req.params;

  //  // replace with default values if nothing specified
  //  customer.description = (updates.description||'');
  //  customer.emails = (updates.emails||[]);
  //  customer.config = (updates.config||{
  //    monitor:{},
  //    elasticsearch:{enabled:false}
  //  });

  //  customer.save( err => {
  //    if (err) return res.send(500,err);
  //    res.send(200, customer);
  //  });
  //},
  /**
   *
   *
   */
  remove (req, res, next) {
    var customer = req.customer;

    CustomerService.remove(customer, err => {
      if (err) {
        logger.error(err);
        return res.send(500,err);
      }

      /** disable customer hosts **/
      HostService.disableHostsByCustomer(customer);
      /** disable customer resources **/
      ResourceService.disableResourcesByCustomer(customer);

      logger.data('customer removed %j',customer);

      res.json(200, customer);
      next();
    });
  }
};
