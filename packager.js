'use strict';
var packager = require('electron-packager');
var fs = require('fs');
try{
	fs.unlinkSync('./temp.wav');
}catch(e){
	
}
var options = {
    'arch': 'ia32',
    'platform': 'win32',
    'dir': './',
    'app-copyright': '',
    'app-version': '1',
    'asar': true,
    'icon': './app.ico',
    'name': 'Graphical_Skipjacker',
    'out': '../releases',
    'overwrite': true,
    'prune': true,
    'version': '1',
    'version-string': {
        'CompanyName': 'Sam Hayzen',
        'FileDescription': 'Graphical_Skipjacker', /*This is what display windows on task manager, shortcut and process*/
        'OriginalFilename': 'Skipjacker',
        'ProductName': 'Graphical_Skipjacker',
        'InternalName': 'Skipjacker'
    }
};
packager(options, function done_callback(err, appPaths) {
    console.log("Error: ", err);
    console.log("appPaths: ", appPaths);
});