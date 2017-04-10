/**
 * Copyright 2013-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule GesturePropagators
 * @flow
 */

'use strict';

const EventPluginHub = require('EventPluginHub');
const EventPluginUtils = require('EventPluginUtils');

const accumulateInto = require('accumulateInto');
const warning = require('warning');

function accumulateDispatch(inst, event) {
  if (__DEV__) {
    warning(
      inst,
      'Dispatching inst must not be null'
    );
  }
  var registrationName = event.dispatchConfig.registrationName;
  var listener = EventPluginHub.getListener(inst, registrationName);
  if (listener) {
    event._dispatchListeners =
      accumulateInto(event._dispatchListeners, listener);
    event._dispatchInstances = accumulateInto(event._dispatchInstances, inst);
  }
}

// Accumulate `gestureStart` dispatches top-down for the target instance and its ancestors.
function accumulateStartDispatches(targetInst, event) {
  const instances = [];

  let inst = targetInst;
  while (inst) {
    instances.push(inst);
    inst = EventPluginUtils.getParentInstance(inst);
  }

  let index = instances.length;
  while (index-- > 0) {
    accumulateDispatch(instances[index], event);
  }
}

// Accumulate `gestureEnd` dispatches bottom-up for the target instance and its ancestors.
function accumulateEndDispatches(targetInst, event) {
  let inst = targetInst;
  while (inst) {
    accumulateDispatch(inst, event);
    inst = EventPluginUtils.getParentInstance(inst);
  }
}

// Accumulate `gestureEnd` dispatches bottom-up for descendants of the target instance.
function accumulateDescendantDispatches(deepestInst, targetInst, event) {
  let inst = deepestInst;
  while (inst && inst !== targetInst) {
    accumulateDispatch(inst, event);
    inst = EventPluginUtils.getParentInstance(inst);
  }
}

module.exports = {
  accumulateStartDispatches,
  accumulateEndDispatches,
  accumulateDescendantDispatches,
};
