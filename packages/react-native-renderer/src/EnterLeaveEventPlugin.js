/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {accumulateEnterLeaveDispatches} from 'events/EventPropagators';

import SyntheticEvent from 'events/SyntheticEvent';
import {
  getClosestInstanceFromNode,
  getNodeFromInstance,
} from './ReactNativeComponentTree';

const TOP_MOUSE_OUT = 'topMouseOut';
const TOP_MOUSE_OVER = 'topMouseOver';

const eventTypes = {
  mouseEnter: {
    registrationName: 'onMouseEnter',
    dependencies: [TOP_MOUSE_OUT, TOP_MOUSE_OVER],
  },
  mouseLeave: {
    registrationName: 'onMouseLeave',
    dependencies: [TOP_MOUSE_OUT, TOP_MOUSE_OVER],
  },
};

const EnterLeaveEvent = SyntheticEvent.extend({
  relatedTarget: null,
});

const EnterLeaveEventPlugin = {
  eventTypes: eventTypes,

  /**
   * For almost every interaction we care about, there will be both a top-level
   * `mouseover` and `mouseout` event that occurs. Only use `mouseout` so that
   * we do not extract duplicate events. However, moving the mouse into the
   * browser from outside will not fire a `mouseout` event. In this case, we use
   * the `mouseover` top-level event.
   */
  extractEvents: function(
    topLevelType,
    targetInst,
    nativeEvent,
    nativeEventTarget,
  ) {
    const isOverEvent = topLevelType === TOP_MOUSE_OVER;
    const isOutEvent = topLevelType === TOP_MOUSE_OUT;

    if (isOverEvent && nativeEvent.relatedTarget) {
      return null;
    }

    if (!isOutEvent && !isOverEvent) {
      return null;
    }

    let from;
    let to;
    if (isOutEvent) {
      from = targetInst;
      const related = nativeEvent.relatedTarget;
      to = related ? getClosestInstanceFromNode(related) : null;
    } else {
      // Moving to a node from outside the window.
      from = null;
      to = targetInst;
    }

    if (from === to) {
      // Nothing pertains to our managed components.
      return null;
    }

    const fromNode = from && getNodeFromInstance(from);
    const toNode = to && getNodeFromInstance(to);

    const leave = EnterLeaveEvent.getPooled(
      eventTypes.mouseLeave,
      from,
      nativeEvent,
      nativeEventTarget,
    );
    leave.target = fromNode;
    leave.relatedTarget = toNode;

    const enter = EnterLeaveEvent.getPooled(
      eventTypes.mouseEnter,
      to,
      nativeEvent,
      nativeEventTarget,
    );
    enter.target = toNode;
    enter.relatedTarget = fromNode;

    accumulateEnterLeaveDispatches(leave, enter, from, to);

    return [leave, enter];
  },
};

export default EnterLeaveEventPlugin;
