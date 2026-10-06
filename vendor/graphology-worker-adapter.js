/* The pinned all-in-one Graphology bundle eagerly references XML constructors.
 * Workers do not have a DOM; graph computation does not use XML import/export.
 * Fail explicitly if such an unrelated feature is ever called in a worker. */
self.DOMParser = class UnsupportedWorkerXML {
  constructor() { throw new Error('XML parsing is unavailable in the semantic worker'); }
};
self.Document = class UnsupportedWorkerDocument {};
importScripts('vendor/graphology.min.js', 'vendor/graphology-library.min.js');
delete self.DOMParser;
delete self.Document;
