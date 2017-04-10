/**
 * Copyright 2013-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule GestureCache
 * @flow
 */

'use strict';

import type {Touch, TouchEvent} from 'TouchHistory';

const EventPluginUtils = require('EventPluginUtils');
const ResponderCache = require('ResponderCache');
const TouchHistory = require('TouchHistory');

// Generic traversal used with `TouchList` instances (web only).
const forEach = Function.call.bind(Array.prototype.forEach);

export type Gesture = {
  target: number,
  touchMap: {[key:number]: Touch},
  changedTouches: Array<Touch>,
  touchHistory: TouchHistory,
};

const activeGestures = [];
const gesturesByTouch = {};
const gesturesByTarget = {};

function targetChanged(topLevelType: string, oldTarget: any, newTarget: any): void {

  const oldTag = EventPluginUtils.getTagFromInstance(oldTarget);
  const oldGesture = gesturesByTarget[oldTag];
  if (!oldGesture) {
    return console.warn(`Invalid target has no gesture: ${oldTag}`);
  }

  const newTag = EventPluginUtils.getTagFromInstance(newTarget);
  const newGesture = gesturesByTarget[newTag];

  // Move touch data from `oldGesture` to `newGesture`.
  if (newGesture) {
    newGesture.touchHistory.recordTouchEvent(
      topLevelType, oldGesture.changedTouches
    );
    forEach(oldGesture.changedTouches, (touch) => {
      newGesture.changedTouches.push(touch);
    });
    for (let identifier in oldGesture.touchMap) {
      gesturesByTouch[identifier] = newGesture;
      newGesture.touchMap[identifier] = oldGesture.touchMap[identifier];
    }
    removeGesture(oldGesture);
  } else {
    oldGesture.target = newTag;
    gesturesByTarget[newTag] = oldGesture;
    delete gesturesByTarget[oldTag];
  }
}

function touchesChanged(topLevelType: string, nativeEvent: TouchEvent): Array<Gesture> {

  const isStartish = EventPluginUtils.isStartish(topLevelType);
  const isEndish = EventPluginUtils.isEndish(topLevelType);

  activeGestures.forEach(gesture => {
    gesture.changedTouches.length = 0;
  });

  forEach(nativeEvent.changedTouches, (touch) => {
    const gesture = isStartish ?
      attachGesture(touch) :
      gesturesByTouch[touch.identifier];

    gesture.changedTouches.push(touch);

    if (!isEndish) {
      // Changed touches are entirely new objects.
      gesture.touchMap[touch.identifier] = touch;
    }
  });

  // Detach ended touches from their gestures.
  if (isEndish) {
    forEach(nativeEvent.changedTouches, (touch) => {
      const {identifier} = touch;
      const gesture = gesturesByTouch[identifier];

      // Remove the touch from the gesture, but *not* vice versa.
      delete gesture.touchMap[identifier];
      delete gesturesByTouch[identifier];
    });
  }

  // Create an event for every changed gesture.
  const events = [];

  // We must start from the end of `activeGestures`
  // because ended gestures are removed while looping.
  for (let i = activeGestures.length - 1; i >= 0; i--) {
    const gesture = activeGestures[i];
    if (!gesture.changedTouches.length) {
      continue;
    }

    // Update the touch history of every gesture with changed touches.
    gesture.touchHistory.recordTouchEvent(
      topLevelType, gesture.changedTouches
    );

    // TODO: 'pageX' and 'pageY' may need to be computed for each gesture.
    const event = {
      target: gesture.target,
      touchHistory: gesture.touchHistory,
      changedTouches: gesture.changedTouches,
      touches: Object.values(gesture.touchMap),
    };
    events.push(event);

    // Copy properties from the original `nativeEvent`.
    Object.getOwnPropertyNames(nativeEvent).forEach(name => {
      if (!event.hasOwnProperty(name)) {
        event[name] = nativeEvent[name];
      }
    });

    // When a gesture has no touches, remove it from the cache.
    if (isEndish && gesture.touchHistory.numberActiveTouches === 0) {
      removeGesture(gesture);
    }
  }

  return events;
}

// Attach a gesture to a touch. Create a gesture if necessary.
function attachGesture(touch: Touch): Gesture {

  // Using `findAncestor` means child responders cannot start
  // new gestures while a parent has an active gesture.
  const responderInst = ResponderCache.findAncestor(touch.target);
  const targetNode =
    responderInst ?
    EventPluginUtils.getNodeFromInstance(responderInst) :
    touch.target;

  const target = EventPluginUtils.getTagFromNode(targetNode);

  // Use the same gesture between touches with the same target.
  let gesture = gesturesByTarget[target];
  if (!gesture) {
    gesture = {
      target,
      touchMap: {},
      changedTouches: [],
      touchHistory: new TouchHistory(),
    };
    activeGestures.push(gesture);
    gesturesByTarget[target] = gesture;
  }

  gesturesByTouch[touch.identifier] = gesture;
  return gesture;
}

// Remove a gesture from the global cache.
function removeGesture(gesture: Gesture): void {
  const index = activeGestures.indexOf(gesture);
  activeGestures.splice(index, 1);
  delete gesturesByTarget[gesture.target];
}

module.exports = {
  touchesChanged,
  targetChanged,
};
