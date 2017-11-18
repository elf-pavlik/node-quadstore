/* eslint global-require: "off" */


'use strict';

const factory = require('rdf-data-model');
const RdfStore = require('..').RdfStore;
const asynctools = require('asynctools');

module.exports = (parentBeforeEach, parentAfterEach) => {

  describe('RdfStore', () => {

    beforeEach(async function () {
      await parentBeforeEach.call(this);
      this.store = new RdfStore(this.db, { dataFactory: factory });
      await asynctools.waitForEvent(this.store, 'ready');
    });

    afterEach(async function () {
      await this.store.close();
      await parentAfterEach.call(this);
    });

    require('./rdfstore.prototype.match')();
    require('./rdfstore.prototype.sparql')();
    require('./rdfstore.prototype.del')();
    require('./rdfstore.prototype.remove')();
    require('./rdfstore.prototype.import')();
    require('./rdfstore.prototype.removematches')();

    require('./rdfstore.http')();

  });
};
