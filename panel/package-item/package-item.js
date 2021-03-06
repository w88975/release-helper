var Fs = require('fire-fs');
var Async = require('async');
var Shell = require('shell');
var Semver = require('semver');
var Path = require('fire-path');

Polymer({
    is: 'package-item',

    properties: {
        value: {
            type: Array,
            value: function () {
                return [];
            }
        },

        folded: {
            type: Boolean,
            value: false,
            reflectToAttribute: true,
        },

        _dirty: {
            type: Boolean,
            value: false,
            reflectToAttribute: true,
        },

        invalid: {
            type: Boolean,
            value: false,
        },

        _checked: {
            type: Boolean,
            value: false,
        },

        tag: {
            type: String,
            value: '',
        },

        oldVersions: {
            type: Object,
            value: function () {
                return {};
            },
        }
    },

    ready: function () {
        this.oldVersion = this.value.info.version;
        this.syncGitTag();

        this.oldVersions.hosts = this.value.info.hosts;
        this.oldVersions.dependencies = this.value.info.dependencies;
    },

    _cancelSelect: function () {
        this._checked = false;
    },

    obj2Array: function (obj) {
        var array = [];
        for (var item in obj) {
            array.push({name: item, version: obj[item]});
        }
        return array;
    },

    formatTag: function (tag) {
        if (!tag) {
            return 'NO TAG';
        }

        return tag;
    },

    _oldHostsVersion: function (item) {
        return this.oldVersions.hosts[item.name];
    },

    _oldDepsVersion: function (item) {
        return this.oldVersions.dependencies[item.name];
    },

    _onFoldClick: function (event) {
        event.stopPropagation();
        this.folded = !this.folded;
    },

    _versionChanged: function (event) {
        this.verify(event.target);
        if (!Semver.gt(event.target.value, this.oldVersion)) {
            event.target.value = this.oldVersion;
        }
        this.setDirty();
    },

    _onHostChanged: function (event) {
        this.verify(event.target);
        var keyName = this.$.hoststemplate.itemForElement(event.target).name;
        this.value.info.hosts[keyName] = event.target.value;
        this.setDirty();
    },

    _onDependenciesChanged: function (event) {
        this.verify(event.target);
        var keyName = this.$.deptemplate.itemForElement(event.target).name;
        this.value.info.dependencies[keyName] = event.target.value;
        this.setDirty();
    },

    setDirty: function () {
        this.fire('item-dirty');
        this._dirty = true;
    },

    syncGitTag: function (cb) {
        var path = this.value.path;
        var commands = 'git for-each-ref --sort=taggerdate refs/tags --format \'%(refname)\'';
        Editor.sendRequestToCore('release-helper:exec-cmd', commands, path, function( error,stdout,stderr ) {
            if (error) {
                Editor.error(stderr);
                return;
            }

            if (!stdout) {
                this.set('tag','');
                if (cb) {
                    cb('');
                }
                return;
            }

            var tags = stdout.split('\n');
            var reftags = tags[tags.length - 2];
            var tag = reftags.split('/');
            tag = tag[tag.length-1];
            this.set('tag',tag);
            if (cb) {
                cb(this.tag);
            }
        }.bind(this));
    },

    fetchTag: function (cb) {
        var path = this.value.path;
        this.$.loader.hidden = false;
        Async.series([
            function (next) {
                var commands = 'git tag -l | xargs git tag -d';
                Editor.sendRequestToCore('release-helper:exec-cmd', commands, path, function( error, stdout, stderr ) {
                    next(error, stdout, stderr );
                });
            },

            function (next) {
                var commands = 'git fetch --tags';
                Editor.sendRequestToCore('release-helper:exec-cmd', commands, path, function( error, stdout, stderr ) {
                    next(error, stdout, stderr );
                });
            } ,
        ],function (error, stdout, stderr) {
            if (error) {
                Editor.error(stderr);
            }
            this.$.loader.hidden = true;
            if (cb) {
                cb();
            }
        }.bind(this));
    },

    syncDependencies: function () {
        for (var hostName in this.value.info.hosts) {
            this._refreshHosts(hostName);
        }
        for (var depName in this.value.info.dependencies) {
            this._refreshDependencies(depName);
        }
    },

    confirm: function () {
        Fs.readFile(Path.join(this.value.path, 'package.json'), function (err, data) {
            if (err) {
                Editor.error(err);
                return;
            }

            var obj = JSON.parse(data.toString());
            obj.version = this.value.info.version;
            obj.hosts = this.value.info.hosts;
            obj.dependencies = this.value.info.dependencies;
            var json = JSON.stringify(obj, null, 2);
            Fs.writeFile( Path.join(this.value.path, 'package.json'), json, function (err, state) {
                if (err) {
                    Editor.error(err);
                }
            });
        }.bind(this));

        this._dirty = false;
    },

    verify: function (target) {
        // Checking the version's format
        if (!/^(=|>=|<=|>|<|\^|)[0-9]+\.[0-9]+\.([0-9]+|x)$/.test(target.value)) {
            target.invalid = true;
            this.folded = true;
            return;
        }

        target.invalid = false;
    },

    _foldClass: function (folded) {
        if (folded) {
            return 'icon pointer flex-none fa fa-caret-down';
        }

        return 'icon pointer flex-none fa fa-caret-right';
    },

    _onShowinFinderClick: function (event) {
        event.stopPropagation();
        Shell.showItemInFolder(this.value.path);
        Shell.beep();
    },

    updateVersion: function (type) {
        this.set('value.info.version', Semver.inc(this.value.info.version, type));
    },

    _refreshDependencies: function (name) {
        Editor.Package.queryInfo(name, function (res) {
            if (!res.info) {
                return;
            }

            var dependencies = this.value.info.dependencies;
            var modifier = dependencies[name].substr(0, dependencies[name].indexOf(dependencies[name].match(/[0-9]+/)[0]));
            dependencies[name] = modifier + res.info.version;
            this.set('value.info.dependencies', {});
            this.set('value.info.dependencies', dependencies);
        }.bind(this));
    },

    _refreshHosts: function (name) {
        Editor.sendRequestToCore('release-helper:query-host-version', name, function( version ) {
            var hosts = this.value.info.hosts;
            var modifier = hosts[name].substr(0, hosts[name].indexOf(hosts[name].match(/[0-9]+/)[0]));
            hosts[name] = modifier + version;
            this.set('value.info.hosts', {});
            this.set('value.info.hosts', hosts);
        }.bind(this));
    },

    _onRefreshHostsClick: function (event) {
        event.stopPropagation();
        var name = this.$.hoststemplate.itemForElement(event.target).name;
        this._refreshHosts(name);
    },

    _onRefreshDependenciesClick: function (event) {
        event.stopPropagation();
        var name = this.$.deptemplate.itemForElement(event.target).name;
        this._refreshDependencies(name);
    },

    resetTag: function () {
        var path = this.value.path;
        var commands = 'git tag ' + this.tag + ' -d';
        Editor.sendRequestToCore('release-helper:exec-cmd', commands, path, function( error, stdout, stderr ) {
            if (error) {
                Editor.error(this.value.info.name + ': ' + stderr);
                return;
            }

            this.syncGitTag();
        }.bind(this));
    },

    _tagClass: function (tag, version) {
        if (tag === version) {
            return 'tag mini green';
        }
        else {
            return 'tag mini red';
        }
    },
});
