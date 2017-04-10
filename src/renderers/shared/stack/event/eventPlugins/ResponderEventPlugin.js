/**
 * Copyright 2013-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule ResponderEventPlugin
 */

'use strict';

var EventPluginUtils = require('EventPluginUtils');
var EventPropagators = require('EventPropagators');
var GestureCache = require('GestureCache');
var GesturePropagators = require('GesturePropagators');
var ResponderCache = require('ResponderCache');
var ResponderSyntheticEvent = require('ResponderSyntheticEvent');

var accumulate = require('accumulate');

var isStartish = EventPluginUtils.isStartish;
var isMoveish = EventPluginUtils.isMoveish;
var isEndish = EventPluginUtils.isEndish;
var executeDirectDispatch = EventPluginUtils.executeDirectDispatch;
var hasDispatches = EventPluginUtils.hasDispatches;
var executeDispatchesInOrderStopAtTrue =
  EventPluginUtils.executeDispatchesInOrderStopAtTrue;

/**
 * Count of current touches. A textInput should become responder iff the
 * selection changes while there is a touch on the screen.
 */
var trackedTouchCount = 0;

/**
 * Last reported number of active touches.
 */
var previousActiveTouches = 0;

var eventTypes = {
  /**
   * On a `touchStart`/`mouseDown`, is it desired that this element become the
   * responder?
   */
  startShouldSetResponder: {
    phasedRegistrationNames: {
      bubbled: 'onStartShouldSetResponder',
      captured: 'onStartShouldSetResponderCapture',
    },
  },

  /**
   * On a `scroll`, is it desired that this element become the responder? This
   * is usually not needed, but should be used to retroactively infer that a
   * `touchStart` had occurred during momentum scroll. During a momentum scroll,
   * a touch start will be immediately followed by a scroll event if the view is
   * currently scrolling.
   *
   * TODO: This shouldn't bubble.
   */
  scrollShouldSetResponder: {
    phasedRegistrationNames: {
      bubbled: 'onScrollShouldSetResponder',
      captured: 'onScrollShouldSetResponderCapture',
    },
  },

  /**
   * On text selection change, should this element become the responder? This
   * is needed for text inputs or other views with native selection, so the
   * JS view can claim the responder.
   *
   * TODO: This shouldn't bubble.
   */
  selectionChangeShouldSetResponder: {
    phasedRegistrationNames: {
      bubbled: 'onSelectionChangeShouldSetResponder',
      captured: 'onSelectionChangeShouldSetResponderCapture',
    },
  },

  /**
   * On a `touchMove`/`mouseMove`, is it desired that this element become the
   * responder?
   */
  moveShouldSetResponder: {
    phasedRegistrationNames: {
      bubbled: 'onMoveShouldSetResponder',
      captured: 'onMoveShouldSetResponderCapture',
    },
  },

  gestureStart: {registrationName: 'onGestureStart'},
  gestureEnd: {registrationName: 'onGestureEnd'},

  /**
   * Direct responder events dispatched directly to responder. Do not bubble.
   */
  responderStart: {registrationName: 'onResponderStart'},
  responderMove: {registrationName: 'onResponderMove'},
  responderEnd: {registrationName: 'onResponderEnd'},
  responderRelease: {registrationName: 'onResponderRelease'},
  responderTerminationRequest: {
    registrationName: 'onResponderTerminationRequest',
  },
  responderGrant: {registrationName: 'onResponderGrant'},
  responderReject: {registrationName: 'onResponderReject'},
  responderTerminate: {registrationName: 'onResponderTerminate'},
};

/**
 *
 * Responder System:
 * ----------------
 *
 * - A global, solitary "interaction lock" on a view.
 * - If a node becomes the responder, it should convey visual feedback
 *   immediately to indicate so, either by highlighting or moving accordingly.
 * - To be the responder means, that touches are exclusively important to that
 *   responder view, and no other view.
 * - While touches are still occurring, the responder lock can be transferred to
 *   a new view, but only to increasingly "higher" views (meaning ancestors of
 *   the current responder).
 *
 * Responder being granted:
 * ------------------------
 *
 * - Touch starts, moves, and scrolls can cause an ID to become the responder.
 * - We capture/bubble `startShouldSetResponder`/`moveShouldSetResponder` to
 *   the "appropriate place".
 * - If nothing is currently the responder, the "appropriate place" is the
 *   initiating event's `targetID`.
 * - If something *is* already the responder, the "appropriate place" is the
 *   first common ancestor of the event target and the current `responderInst`.
 * - Some negotiation happens: See the timing diagram below.
 * - Scrolled views automatically become responder. The reasoning is that a
 *   platform scroll view that isn't built on top of the responder system has
 *   began scrolling, and the active responder must now be notified that the
 *   interaction is no longer locked to it - the system has taken over.
 *
 * - Responder being released:
 *   As soon as no more touches that *started* inside of descendants of the
 *   *current* responderInst, an `onResponderRelease` event is dispatched to the
 *   current responder, and the responder lock is released.
 *
 * TODO:
 * - on "end", a callback hook for `onResponderEndShouldRemainResponder` that
 *   determines if the responder lock should remain.
 * - If a view shouldn't "remain" the responder, any active touches should by
 *   default be considered "dead" and do not influence future negotiations or
 *   bubble paths. It should be as if those touches do not exist.
 * -- For multitouch: Usually a translate-z will choose to "remain" responder
 *  after one out of many touches ended. For translate-y, usually the view
 *  doesn't wish to "remain" responder after one of many touches end.
 * - Consider building this on top of a `stopPropagation` model similar to
 *   `W3C` events.
 * - Ensure that `onResponderTerminate` is called on touch cancels, whether or
 *   not `onResponderTerminationRequest` returns `true` or `false`.
 *
 */

/*                                             Negotiation Performed
                                             +-----------------------+
                                            /                         \
Process low level events to    +     Current Responder      +   wantsResponderID
determine who to perform negot-|   (if any exists at all)   |
iation/transition              | Otherwise just pass through|
-------------------------------+----------------------------+------------------+
Bubble to find first ID        |                            |
to return true:wantsResponderID|                            |
                               |                            |
     +-------------+           |                            |
     | onTouchStart|           |                            |
     +------+------+     none  |                            |
            |            return|                            |
+-----------v-------------+true| +------------------------+ |
|onStartShouldSetResponder|----->|onResponderStart (cur)  |<-----------+
+-----------+-------------+    | +------------------------+ |          |
            |                  |                            | +--------+-------+
            | returned true for|       false:REJECT +-------->|onResponderReject
            | wantsResponderID |                    |       | +----------------+
            | (now attempt     | +------------------+-----+ |
            |  handoff)        | |   onResponder          | |
            +------------------->|      TerminationRequest| |
                               | +------------------+-----+ |
                               |                    |       | +----------------+
                               |         true:GRANT +-------->|onResponderGrant|
                               |                            | +--------+-------+
                               | +------------------------+ |          |
                               | |   onResponderTerminate |<-----------+
                               | +------------------+-----+ |
                               |                    |       | +----------------+
                               |                    +-------->|onResponderStart|
                               |                            | +----------------+
Bubble to find first ID        |                            |
to return true:wantsResponderID|                            |
                               |                            |
     +-------------+           |                            |
     | onTouchMove |           |                            |
     +------+------+     none  |                            |
            |            return|                            |
+-----------v-------------+true| +------------------------+ |
|onMoveShouldSetResponder |----->|onResponderMove (cur)   |<-----------+
+-----------+-------------+    | +------------------------+ |          |
            |                  |                            | +--------+-------+
            | returned true for|       false:REJECT +-------->|onResponderRejec|
            | wantsResponderID |                    |       | +----------------+
            | (now attempt     | +------------------+-----+ |
            |  handoff)        | |   onResponder          | |
            +------------------->|      TerminationRequest| |
                               | +------------------+-----+ |
                               |                    |       | +----------------+
                               |         true:GRANT +-------->|onResponderGrant|
                               |                            | +--------+-------+
                               | +------------------------+ |          |
                               | |   onResponderTerminate |<-----------+
                               | +------------------+-----+ |
                               |                    |       | +----------------+
                               |                    +-------->|onResponderMove |
                               |                            | +----------------+
                               |                            |
                               |                            |
      Some active touch started|                            |
      inside current responder | +------------------------+ |
      +------------------------->|      onResponderEnd    | |
      |                        | +------------------------+ |
  +---+---------+              |                            |
  | onTouchEnd  |              |                            |
  +---+---------+              |                            |
      |                        | +------------------------+ |
      +------------------------->|     onResponderEnd     | |
      No active touches started| +-----------+------------+ |
      inside current responder |             |              |
                               |             v              |
                               | +------------------------+ |
                               | |    onResponderRelease  | |
                               | +------------------------+ |
                               |                            |
                               +                            + */



/**
 * A note about event ordering in the `EventPluginHub`.
 *
 * Suppose plugins are injected in the following order:
 *
 * `[R, S, C]`
 *
 * To help illustrate the example, assume `S` is `SimpleEventPlugin` (for
 * `onClick` etc) and `R` is `ResponderEventPlugin`.
 *
 * "Deferred-Dispatched Events":
 *
 * - The current event plugin system will traverse the list of injected plugins,
 *   in order, and extract events by collecting the plugin's return value of
 *   `extractEvents()`.
 * - These events that are returned from `extractEvents` are "deferred
 *   dispatched events".
 * - When returned from `extractEvents`, deferred-dispatched events contain an
 *   "accumulation" of deferred dispatches.
 * - These deferred dispatches are accumulated/collected before they are
 *   returned, but processed at a later time by the `EventPluginHub` (hence the
 *   name deferred).
 *
 * In the process of returning their deferred-dispatched events, event plugins
 * themselves can dispatch events on-demand without returning them from
 * `extractEvents`. Plugins might want to do this, so that they can use event
 * dispatching as a tool that helps them decide which events should be extracted
 * in the first place.
 *
 * "On-Demand-Dispatched Events":
 *
 * - On-demand-dispatched events are not returned from `extractEvents`.
 * - On-demand-dispatched events are dispatched during the process of returning
 *   the deferred-dispatched events.
 * - They should not have side effects.
 * - They should be avoided, and/or eventually be replaced with another
 *   abstraction that allows event plugins to perform multiple "rounds" of event
 *   extraction.
 *
 * Therefore, the sequence of event dispatches becomes:
 *
 * - `R`s on-demand events (if any)   (dispatched by `R` on-demand)
 * - `S`s on-demand events (if any)   (dispatched by `S` on-demand)
 * - `C`s on-demand events (if any)   (dispatched by `C` on-demand)
 * - `R`s extracted events (if any)   (dispatched by `EventPluginHub`)
 * - `S`s extracted events (if any)   (dispatched by `EventPluginHub`)
 * - `C`s extracted events (if any)   (dispatched by `EventPluginHub`)
 *
 * In the case of `ResponderEventPlugin`: If the `startShouldSetResponder`
 * on-demand dispatch returns `true` (and some other details are satisfied) the
 * `onResponderGrant` deferred dispatched event is returned from
 * `extractEvents`. The sequence of dispatch executions in this case
 * will appear as follows:
 *
 * - `startShouldSetResponder` (`ResponderEventPlugin` dispatches on-demand)
 * - `touchStartCapture`       (`EventPluginHub` dispatches as usual)
 * - `touchStart`              (`EventPluginHub` dispatches as usual)
 * - `responderGrant/Reject`   (`EventPluginHub` dispatches as usual)
 */

function createEvent(eventType, responderInst, nativeEvent) {
  var event = ResponderSyntheticEvent.getPooled(
    eventTypes[eventType],
    responderInst,
    nativeEvent,
    nativeEvent.target
  );
  event.touchHistory = nativeEvent.touchHistory;
  return event;
}

function setResponderAndExtractTransfer(topLevelType, targetInst, nativeEvent) {

  // Active responders always capture touches within descendants.
  var currentInst = ResponderCache.findAncestor(targetInst);
  if (currentInst && currentInst !== targetInst) {
    GestureCache.targetChanged(topLevelType, targetInst, currentInst);
    targetInst = currentInst;
  }

  var eventType =
    isStartish(topLevelType) ? 'startShouldSetResponder' :
    isMoveish(topLevelType) ? 'moveShouldSetResponder' :
    topLevelType === 'topSelectionChange' ?
      'selectionChangeShouldSetResponder' :
    'scrollShouldSetResponder';

  var event = createEvent(eventType, targetInst, nativeEvent);

  // Always skip the current responder.
  if (currentInst) {
    EventPropagators.accumulateTwoPhaseDispatchesSkipTarget(event);
  } else {
    EventPropagators.accumulateTwoPhaseDispatches(event);
  }

  // Perform capturing/bubbling to determine the next responder.
  var nextInst = executeDispatchesInOrderStopAtTrue(event);
  event.isPersistent() || event.constructor.release(event);
  if (!nextInst) {
    return null;
  }

  // Accumulate events that need dispatching.
  var extracted;

  // Perform a termination request if an active responder exists.
  if (currentInst) {
    event = createEvent('responderTerminationRequest', currentInst, nativeEvent);
    EventPropagators.accumulateDirectDispatches(event);

    var shouldSwitch = !hasDispatches(event) || executeDirectDispatch(event);
    event.isPersistent() || event.constructor.release(event);

    // The active responder rejected the termination request.
    if (!shouldSwitch) {
      event = createEvent('responderReject', nextInst, nativeEvent);
      EventPropagators.accumulateDirectDispatches(event);
      return accumulate(extracted, event);
    }

    // The previous responder has been terminated.
    ResponderCache.release(currentInst);

    event = createEvent('responderTerminate', currentInst, nativeEvent);
    EventPropagators.accumulateDirectDispatches(event);
    hasDispatches(event) && executeDirectDispatch(event);
  }

  if (nextInst !== targetInst) {
    event = createEvent('gestureEnd', nextInst, nativeEvent);
    GesturePropagators.accumulateDescendantDispatches(targetInst, nextInst, event);
    extracted = accumulate(extracted, event);

    // The capturing responder becomes the new target.
    GestureCache.targetChanged(topLevelType, targetInst, nextInst);
  }

  event = createEvent('responderGrant', nextInst, nativeEvent);
  EventPropagators.accumulateDirectDispatches(event);

  var blockHostResponder = executeDirectDispatch(event) === true;
  ResponderCache.grant(nextInst, blockHostResponder);

  return extracted;
}

/**
 * A transfer is a negotiation between a currently set responder and the next
 * element to claim responder status. Any start event could trigger a transfer
 * of responderInst. Any move event could trigger a transfer.
 *
 * @param {string} topLevelType Record from `EventConstants`.
 * @return {boolean} True if a transfer of responder could possibly occur.
 */
function canTriggerTransfer(topLevelType, topLevelInst, nativeEvent) {
  return topLevelInst && (
    // responderIgnoreScroll: We are trying to migrate away from specifically
    // tracking native scroll events here and responderIgnoreScroll indicates we
    // will send topTouchCancel to handle canceling touch events instead
    (topLevelType === 'topScroll' &&
      !nativeEvent.responderIgnoreScroll) ||
    (trackedTouchCount > 0 &&
      topLevelType === 'topSelectionChange') ||
    isStartish(topLevelType) ||
    isMoveish(topLevelType)
  );
}

function extractTouchEvents(topLevelType, targetInst, nativeEvent) {
  var extracted;

  if (canTriggerTransfer(topLevelType, targetInst, nativeEvent)) {
    extracted = setResponderAndExtractTransfer(
      topLevelType,
      targetInst,
      nativeEvent
    );
  }

  // Find the first ancestor that is currently responding.
  var currentInst = ResponderCache.findAncestor(targetInst);
  if (!currentInst) {
    return extracted;
  }

  var eventType =
    isStartish(topLevelType) ? 'responderStart' :
    isMoveish(topLevelType) ? 'responderMove' :
    isEndish(topLevelType) ? 'responderEnd' :
    null;

  // Extract an incremental touch event.
  if (eventType) {
    var event = createEvent(eventType, currentInst, nativeEvent);
    EventPropagators.accumulateDirectDispatches(event);
    extracted = accumulate(extracted, event);
  }

  if (!isEndish(topLevelType)) {
    return extracted;
  }

  if (topLevelType === 'topTouchCancel') {
    eventType = 'responderTerminate';
  } else if (nativeEvent.touchHistory.numberActiveTouches === 0) {
    eventType = 'responderRelease';
  } else {
    return extracted;
  }

  ResponderCache.release(currentInst);

  event = createEvent(eventType, currentInst, nativeEvent);
  EventPropagators.accumulateDirectDispatches(event);
  return accumulate(extracted, event);
}

var ResponderEventPlugin = {

  /* For unit testing only */
  _getResponderID: function() {
    return responderInst ? responderInst._rootNodeID : null;
  },

  eventTypes: eventTypes,

  /**
   * We must be resilient to `targetInst` being `null` on `touchMove` or
   * `touchEnd`. On certain platforms, this means that a native scroll has
   * assumed control and the original touch targets are destroyed.
   */
  extractEvents: function(topLevelType, targetInst, nativeEvent) {

    // Currently, only touch events are extracted.
    if (!nativeEvent.touches) {
      console.warn('Native event has no touches: ' + topLevelType);
      return null;
    }

    if (isStartish(topLevelType)) {
      trackedTouchCount += nativeEvent.changedTouches.length;
    } else if (isEndish(topLevelType)) {
      trackedTouchCount -= nativeEvent.changedTouches.length;
      if (trackedTouchCount < 0) {
        console.error(
          'Ended a touch event which was not counted in `trackedTouchCount`.'
        );
        return null;
      }
    }

    // Accumulate events that need dispatching.
    var extracted;

    // Touches are grouped by current target.
    GestureCache.touchesChanged(topLevelType, nativeEvent).forEach(event => {
      var targetInst = EventPluginUtils.getInstanceFromTag(event.target);

      // Dispatch a `gestureStart` event to every potential responder.
      if (isStartish(topLevelType) && event.touches.length === event.changedTouches.length) {
        var startEvent = createEvent('gestureStart', targetInst, event);
        GesturePropagators.accumulateStartDispatches(targetInst, startEvent);
        EventPluginUtils.executeDispatchesInOrder(startEvent, false);
        startEvent.isPersistent() || startEvent.constructor.release(startEvent);
      }

      var touchEvents = extractTouchEvents(topLevelType, targetInst, event);
      if (touchEvents) {
        extracted = accumulate(extracted, touchEvents);
      }

      // Dispatch a `gestureEnd` event to every responder that needs it.
      // Start from the bottom and skip descendants of the current responder.
      if (isEndish(topLevelType) && event.touches.length === 0) {
        var endEvent = createEvent('gestureEnd', targetInst, event);
        GesturePropagators.accumulateEndDispatches(targetInst, endEvent);
        extracted = accumulate(extracted, endEvent);
      }
    });

    var interactionHandler = ResponderEventPlugin.GlobalInteractionHandler;
    if (interactionHandler && trackedTouchCount !== previousActiveTouches) {
      interactionHandler.onChange(trackedTouchCount);
    }
    previousActiveTouches = trackedTouchCount;

    return extracted;
  },

  GlobalInteractionHandler: null,

  injection: {
    /**
     * @param {{onChange: (ReactID, ReactID) => void} GlobalResponderHandler
     * Object that handles any change in responder. Use this to inject
     * integration with an existing touch handling system etc.
     */
    injectGlobalResponderHandler: function(GlobalResponderHandler) {
      ResponderCache.globalHandler = GlobalResponderHandler;
    },

    /**
     * @param {{onChange: (numberActiveTouches) => void} GlobalInteractionHandler
     * Object that handles any change in the number of active touches.
     */
    injectGlobalInteractionHandler: function(GlobalInteractionHandler) {
      ResponderEventPlugin.GlobalInteractionHandler = GlobalInteractionHandler;
    },
  },
};

module.exports = ResponderEventPlugin;
