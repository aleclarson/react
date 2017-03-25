
var moduleMap = require('fbjs/module-map');

moduleMap['object-assign'] = 'object-assign';

module.exports = Object.assign(moduleMap, {

  // Alias
  React: 'react/lib/React',

  // Shared state
  ReactCurrentOwner: 'react/lib/ReactCurrentOwner',
  ReactComponentTreeHook: 'react/lib/ReactComponentTreeHook',

  // Addons needs to reach into DOM internals
  ReactDOM: 'react-dom/lib/ReactDOM',
  ReactInstanceMap: 'react-dom/lib/ReactInstanceMap',
  ReactTestUtils: 'react-dom/lib/ReactTestUtils',
  ReactPerf: 'react-dom/lib/ReactPerf',
  getVendorPrefixedEventName: 'react-dom/lib/getVendorPrefixedEventName',

  // React Native Hooks
  deepDiffer: 'react-native/lib/deepDiffer',
  deepFreezeAndThrowOnMutationInDev: 'react-native/lib/deepFreezeAndThrowOnMutationInDev',
  flattenStyle: 'react-native/lib/flattenStyle',
  InitializeJavaScriptAppEngine: 'react-native/lib/InitializeJavaScriptAppEngine',
  RCTEventEmitter: 'react-native/lib/RCTEventEmitter',
  TextInputState: 'react-native/lib/TextInputState',
  UIManager: 'react-native/lib/UIManager',
  UIManagerStatTracker: 'react-native/lib/UIManagerStatTracker',
  View: 'react-native/lib/View',
});
