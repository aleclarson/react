
nvm use 4

grunt delete-build-modules
grunt version-check
grunt build-modules
grunt browserify:basic
grunt browserify:dom
grunt npm-react:release
grunt npm-react-dom:release
grunt npm-react-native:release

cd build/packages/react
deps link
npm install
cd ..

cd react-dom
deps link
npm install
cd ..

cd react-native-renderer
deps link
npm install
cd ../../..

nvm use 6
