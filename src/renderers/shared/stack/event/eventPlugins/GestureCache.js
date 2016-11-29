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

export type Gesture = {
  target: number,
  touchMap: {[key:number]: Touch},
  changedTouches: Array<Touch>,
  touchHistory: TouchHistory,
};

const activeGestures = [];
const gesturesByTouch = {};
const gesturesByTarget = {};

exports.targetChanged = function(topLevelType: string, oldTarget: any, newTarget: any): void {
  const oldTag = EventPluginUtils.getNodeFromInstance(oldTarget);
  const newTag = EventPluginUtils.getNodeFromInstance(newTarget);
  if (newTag === oldTag) {
    return console.warn(`Targets cannot be equal`);
  }
  const oldGesture = gesturesByTarget[oldTag];
  const newGesture = gesturesByTarget[newTag];
  if (!oldGesture) {
    return console.warn(`Invalid target has no gesture: ${oldTag}`);
  }
  if (newGesture) {
    newGesture.touchHistory.recordTouchEvent(
      topLevelType, oldGesture.changedTouches
    );
    oldGesture.changedTouches.forEach(touch => {
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
};

exports.touchesChanged = function(topLevelType: string, nativeEvent: TouchEvent): Array<Gesture> {

  activeGestures.forEach(gesture => {
    gesture.changedTouches.length = 0;
  });

  const isStartish = EventPluginUtils.isStartish(topLevelType);
  const isEndish = EventPluginUtils.isEndish(topLevelType);

  // Rebuild the `changedTouches` of each gesture.
  nativeEvent.changedTouches.forEach(touch => {

    // Ensure every touch is associated with a gesture.
    const gesture = isStartish ?
      attachGesture(touch) :
      gesturesByTouch[touch.identifier];

    gesture.changedTouches.push(touch);

    if (!isEndish) {
      // The touches are new objects for all events.
      gesture.touchMap[touch.identifier] = touch;
    }
  });

  // Detach ended touches from their gestures.
  if (isEndish) {
    nativeEvent.changedTouches.forEach(touch => {
      const {identifier} = touch;
      const gesture = gesturesByTouch[identifier];

      // Remove the touch from the gesture, but *not* vice versa.
      delete gesture.touchMap[identifier];
      delete gesturesByTouch[identifier];
    });
  }

  const changedGestures = [];
  activeGestures.forEach(gesture => {
    // Ignore gestures without changed touches.
    if (!gesture.changedTouches.length) return;
    changedGestures.push(gesture);

    // Update the touch history of every gesture with changed touches.
    gesture.touchHistory.recordTouchEvent(
      topLevelType, gesture.changedTouches
    );

    // When a gesture has no touches, remove it from the cache.
    if (isEndish && gesture.touchHistory.numberActiveTouches == 0) {
      removeGesture(gesture);
    }
  });
  return changedGestures;
};

// Attach a gesture to a touch. Create a gesture if necessary.
function attachGesture(touch: Touch): Gesture {

  // Using `findAncestor` means child responders cannot start
  // new gestures while a parent has an active gesture.
  const responderInst = ResponderCache.findAncestor(touch.target);
  const target = responderInst ?
    EventPluginUtils.getNodeFromInstance(responderInst) :
    touch.target;

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
