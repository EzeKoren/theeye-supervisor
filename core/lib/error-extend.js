
Error.prototype.toJSON = function () {
  var alt = {};
  var storeKey = function(key) {
    alt[key] = this[key];
  };
  Object.getOwnPropertyNames(this).forEach(storeKey, this);
};

//Error.prototype.toString = properties;
