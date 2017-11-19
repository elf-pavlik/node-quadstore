
'use strict';

const _ = require('lodash');
const n3u = require('n3').Util;
const utils = require('./utils');
const debug = require('debug')('quadstore:rdfstore');
const stream = require('stream');
const assert = require('assert');
const events = require('events');
const QuadStore = require('./quadstore');
const HttpServer = require('./http/server');
const SparqlEngine = require('rdfjs-sparql-engine');

const XSD = 'http://www.w3.org/2001/XMLSchema#';

const MIN_INTEGER = Math.ceil(Number.MIN_SAFE_INTEGER / 2);
const MAX_INTEGER = Math.floor(Number.MAX_SAFE_INTEGER / 2);

const INTEGER_LENGTH = ((MAX_INTEGER - MIN_INTEGER) + '').length;

function numberToString(num) {
  return ('' + Math.floor(num - MIN_INTEGER)).padStart(INTEGER_LENGTH, '0') + '.' + ('' + (num % 1)).slice(2);
}

const INT_TYPE_NUMBER = 'number';
const INT_TYPE_DATETIME = 'datetime';

class RdfStore extends QuadStore {

  constructor(path, opts) {
    if (_.isNil(opts)) {
      opts = {};
    }
    assert(_.isObject(opts), 'Invalid `opts` arguments.');
    const superOpts = _.extend(
      { defaultContextValue: 'urn:quadstore:dg' },
      opts,
      { contextKey: 'graph' }
    );
    super(path, superOpts);
    const store = this;
    assert(_.isObject(opts.dataFactory), 'Missing "opts.dataFactory" property.');
    utils.defineReadOnlyProperty(store, 'dataFactory', opts.dataFactory);
    store._httpPort = opts.httpPort || '8883';
    store._httpAddr = opts.httpAddr || '127.0.0.1';
    store._httpBaseUrl = opts.httpBaseUrl || 'http://127.0.0.1:8883';
    store._sparqlEngine = new SparqlEngine(this);
  }

  _initialize() {
    const store = this;
    const server = store._httpServer = new HttpServer(this, {
      baseUrl: store._httpBaseUrl
    });
    server.listen(store._httpPort, store._httpAddr, (err) => {
      if (err) {
        store.emit('error', utils.wrapError(err, 'Cannot start listening. Could not initialize store.'));
        return;
      }
      store.emit('ready');
    });
  }

  static get valueEncoding() {
    return QuadStore.valueEncoding;
  }

  sparql(query) {
    debug(`sparql query: ${query}`);
    return utils.createIteratorStream(this._sparqlEngine.query(query));
  }

  /**
   * RDF/JS.Source.match()
   * @param subject
   * @param predicate
   * @param object
   * @param graph
   * @returns {*}
   */
  match(subject, predicate, object, graph) {
    if (!_.isNil(subject)) assert(_.isString(subject.termType) || _.isArray(subject), 'The "subject" argument is not an Term.');
    if (!_.isNil(predicate)) assert(_.isString(predicate.termType) || _.isArray(predicate), 'The "predicate" argument is not an Term.');
    if (!_.isNil(object)) assert(_.isString(object.termType) || _.isArray(object), 'The "object" argument is not an Term.');
    if (!_.isNil(graph)) assert(_.isString(graph.termType) || _.isArray(graph), 'The "graph" argument is not an Term.');
    const matchTerms = { subject, predicate, object, graph };
    return this.getStream(matchTerms);
  }

  /**
   * RDF/JS.Sink.import()
   * @param source
   * @param opts
   * @returns {*|EventEmitter}
   */
  import(source, opts) {
    if (_.isNil(opts)) opts = {};
    assert(utils.isReadableStream(source), 'The "source" argument is not a readable stream.');
    assert(_.isObject(opts), 'The "opts" argument is not an object.');
    const emitter = new events.EventEmitter();
    this.putStream(source, opts, (err) => {
      if (err) emitter.emit('error', err);
      else emitter.emit('end');
    });
    return emitter;
  }

  /**
   * RDF/JS.Store.remove()
   * @param source
   * @param opts
   * @returns {*|EventEmitter}
   */
  remove(source, opts) {
    if (_.isNil(opts)) opts = {};
    assert(utils.isReadableStream(source), 'The "source" argument is not a readable stream.');
    assert(_.isObject(opts), 'The "opts" argument is not an object.');
    const emitter = new events.EventEmitter();
    this.delStream(source, opts, (err) => {
      if (err) emitter.emit('error', err);
      else emitter.emit('end');
    });
    return emitter;
  }

  /**
   * RDF/JS.Store.removeMatches()
   * @param subject
   * @param predicate
   * @param object
   * @param graph
   * @returns {*}
   */
  removeMatches(subject, predicate, object, graph) {
    const source = this.match(subject, predicate, object, graph);
    return this.remove(source);
  }

  /**
   * RDF/JS.Store.deleteGraph()
   * @param graph
   * @returns {*}
   */
  deleteGraph(graph) {
    return this.removeMatches(null, null, null, graph);
  }

  getStream(matchTerms, opts) {
    if (_.isNil(matchTerms)) matchTerms = {};
    if (_.isNil(opts)) opts = {};
    assert(_.isObject(matchTerms), 'The "matchTerms" argument is not an object.');
    assert(_.isObject(opts), 'The "opts" argument is not an object.');
    const importedMatchTerms = {};
    if (matchTerms.subject) importedMatchTerms.subject = this._importTerm(matchTerms.subject);
    if (matchTerms.predicate) importedMatchTerms.predicate = this._importTerm(matchTerms.predicate);
    if (matchTerms.object) importedMatchTerms.object = this._importTerm(matchTerms.object);
    if (matchTerms.graph) importedMatchTerms.graph = this._importTerm(matchTerms.graph);
    return QuadStore.prototype.getStream.call(this, importedMatchTerms, opts)
      .pipe(this._createQuadDeserializerStream());
  }

  getApproximateSize(matchTerms, opts, cb) {
    const store = this;
    if (_.isNil(matchTerms)) matchTerms = {};
    if (_.isFunction(opts)) {
      cb = opts;
      opts = {};
    }
    if (_.isNil(opts)) opts = {};
    assert(_.isObject(matchTerms), 'The "matchTerms" argument is not a function..');
    assert(_.isObject(opts), 'The "opts" argument is not an object.');
    const importedMatchTerms = {};
    if (matchTerms.subject) importedMatchTerms.subject = this._importTerm(matchTerms.subject);
    if (matchTerms.predicate) importedMatchTerms.predicate = this._importTerm(matchTerms.predicate);
    if (matchTerms.object) importedMatchTerms.object = this._importTerm(matchTerms.object);
    if (matchTerms.graph) importedMatchTerms.graph = this._importTerm(matchTerms.graph);
    return QuadStore.prototype.getApproximateSize.call(this, importedMatchTerms, opts, cb);
  }

  getByIndexStream(name, opts) {
    return QuadStore.prototype.getByIndexStream.call(this, name, opts)
      .pipe(this._createQuadDeserializerStream());
  }

  close(cb) {
    const store = this;
    function _close(resolve, reject) {
      // store._fragmentsClient.abortAll();
      store._httpServer.terminate((serverErr) => {
        if (serverErr) { reject(serverErr); return; }
        QuadStore.prototype.close.call(store, (storeErr) => {
          if (storeErr) { reject(storeErr); return; }
          resolve();
        });
      });
    }
    if (!_.isFunction(cb)) {
      return new Promise(_close);
    }
    _close(cb.bind(null, null), cb);
  }

  _delput(oldQuads, newQuads, opts, cb) {
    const store = this;
    if (!Array.isArray(oldQuads)) oldQuads = [oldQuads];
    if (!Array.isArray(newQuads)) newQuads = [newQuads];
    return QuadStore.prototype._delput.call(this, oldQuads.map(quad => store._importQuad(quad)), newQuads.map(quad => store._importQuad(quad)), opts, cb);
  }

  _isQuad(obj) {
    return QuadStore.prototype._isQuad.call(this, obj)
      && _.isFunction(obj.equals);
  }

  _exportTerm(term, isGraph) {
    let exported;
    const dataFactory = this.dataFactory;
    if (term === this._defaultContextValue) {
      exported = dataFactory.defaultGraph();
    // } else if (n3u.isLiteral(term)) {
    } else if (term.slice(0, 2) === '**') {
      exported = this._exportTerm(term.split('@@').slice(1).join('@@'));
    } else if (n3u.isLiteral(term)) {
      const value = n3u.getLiteralValue(term);
      const datatype = n3u.getLiteralType(term);
      const language = n3u.getLiteralLanguage(term);
      exported = dataFactory.literal(value, language || (datatype && dataFactory.namedNode(datatype)) || null);
    } else if (n3u.isBlank(term)) {
      exported = dataFactory.blankNode(term.slice(2));
    } else if (n3u.isIRI(term)) {
      exported = dataFactory.namedNode(term);
    } else if (!term && isGraph) {
      exported = dataFactory.defaultGraph();
    } else {
      throw new Error(`Bad term ${term}, cannot export`);
    }
    return exported;
  }

  _importFilters(filters) {
    return filters.map((filter) => {
      if (filter.comparate.termType !== 'Literal') {
        throw new Error('NOT SUPPORTED!');
      }
      return {
        test: filter.test,
        comparate: this._importTerm(filter.comparate).split('@@')[0]
      };
    })
  }

  _importTerm(term, isGraph) {
    if (!term) {
      if (isGraph) {
        return undefined;
      } else {
        throw new Error('Null term.');
      }
    }
    if (Array.isArray(term)) {
      return this._importFilters(term);
    }
    switch (term.termType) {
      case 'Literal':
        if (term.language) {
          return `**string@@${n3u.createLiteral(term.value, term.language)}`;
        } else if (term.datatype) {
          const datatype = this._importTerm(term.datatype);
          switch(datatype) {
            case XSD + 'byte':
            case XSD + 'short':
            case XSD + 'decimal':
            case XSD + 'integer':
            case XSD + 'int':
            case XSD + 'long':
            case XSD + 'negativeInteger':
            case XSD + 'positiveInteger':
            case XSD + 'nonNegativeInteger':
            case XSD + 'nonPositiveInteger':
            case XSD + 'unsignedLong':
            case XSD + 'unsignedShort':
            case XSD + 'unsignedInt':
            case XSD + 'unsignedByte':
              return `**number:${numberToString(parseFloat(term.value))}@@${n3u.createLiteral(term.value, datatype)}`;
            case XSD + 'date':
            case XSD + 'dateTime':
              return `**datetime:${numberToString(new Date(term.value).valueOf())}@@${n3u.createLiteral(term.value, datatype)}`;
            default:
              return `**string@@${n3u.createLiteral(term.value, datatype)}`;
          }
        } else {
          return `**string@@${n3u.createLiteral(term.value)}`;
        }
      case 'NamedNode':
        return term.value;
      case 'DefaultGraph':
        return this._defaultContextValue;
      case 'BlankNode':
        return '_:' + term.value;
      default:
        throw new Error('Unsupported termType ' + term.termType);
    }
  }

  _importQuad(quad) {
    const importedQuad = {
      subject: this._importTerm(quad.subject),
      predicate: this._importTerm(quad.predicate),
      object: this._importTerm(quad.object),
      graph: this._importTerm(quad.graph, true)
    };
    debug('Imported quad: %j', importedQuad);
    return importedQuad;
  }

  _exportQuad(quad) {
    const exportedQuad = this.dataFactory.quad(
      this._exportTerm(quad.subject),
      this._exportTerm(quad.predicate),
      this._exportTerm(quad.object),
      this._exportTerm(quad.graph, true)
    );
    debug('Exported quad: %j', exportedQuad);
    return exportedQuad;
  }

  _createQuadComparator() {
    const termNames = ['subject', 'predicate', 'object', this._contextKey];
    return function orderComparator(quadA, quadB) {
      for (let i = 0; i <= termNames.length; i += 1) {
        if (i === termNames.length) return 0;
        else if (quadA[termNames[i]].value < quadB[termNames[i]].value) return -1;
        else if (quadA[termNames[i]].value > quadB[termNames[i]].value) return 1;
      }
    };
  }

  /**
   * Returns a stream that transforms RDF/JS.Quad instances into N3 quads
   */

  _createQuadSerializerStream() {
    const store = this;
    const serializerStream = new stream.Transform({
      objectMode: true,
      transform(quad, enc, cb) {
        this.push(store._importQuad(quad));
        this.count += 1;
        cb();
      }
    });
    serializerStream.count = 0;
    return serializerStream;
  }

  /**
   * Returns a stream that transforms N3 quads into RDF/JS.Quad instances
   */

  _createQuadDeserializerStream() {
    const store = this;
    const deserializerStream = new stream.Transform({
      objectMode: true,
      transform(quad, enc, cb) {
        this.push(store._exportQuad(quad));
        this.count += 1;
        cb();
      }
    });
    deserializerStream.count = 0;
    return deserializerStream;
  }

}

module.exports = RdfStore;
