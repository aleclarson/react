/**
 * Copyright 2013-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule ResponderCache
 */

'use strict';

const EventPluginUtils = require('EventPluginUtils');

const emptyFunction = require('emptyFunction');
const isNode = require('isNode');

// Each active responder (by its react tag).
const cache = Object.create(null);

// Set this to handle responder grant/release/terminate events.
exports.globalHandler = {onChange: emptyFunction};

// Called when a responder becomes active.
exports.grant = function(inst, blockHostResponder) {
  const tag = EventPluginUtils.getTagFromInstance(inst);
  cache[tag] = inst;

  this.globalHandler.onChange(null, inst, blockHostResponder);
};

// Called when a responder becomes inactive.
exports.release = function(inst) {
  const tag = EventPluginUtils.getTagFromInstance(inst);
  delete cache[tag];

  this.globalHandler.onChange(inst, null);
};

// Finds an active responder nearest to `target`.
// May return the `target` itself.
exports.findAncestor = function(target) {
  let inst = resolveInstance(target);
  while (inst != null) {
    let tag = EventPluginUtils.getTagFromInstance(inst);
    if (cache[tag] != null) return inst;
    inst = EventPluginUtils.getParentInstance(inst);
  }
  return null;
};

function resolveInstance(target) {
  if (typeof target === 'number') {
    return EventPluginUtils.getInstanceFromTag(target);
  }
  if (isNode(target)) {
    return EventPluginUtils.getInstanceFromNode(target);
  }
  return target;
}
