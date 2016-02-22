/* -*- Mode: JS2; indent-tabs-mode: nil; js2-basic-offset: 4 -*- */
/* vim: set et ts=4 sw=4: */
/*
 * Copyright (c) 2013 Mattias Bengtsson.
 *
 * GNOME Maps is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by the
 * Free Software Foundation; either version 2 of the License, or (at your
 * option) any later version.
 *
 * GNOME Maps is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
 * or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License
 * for more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with GNOME Maps; if not, see <http://www.gnu.org/licenses/>.
 *
 * Author: Mattias Bengtsson <mattias.jc.bengtsson@gmail.com>
 */

const GObject = imports.gi.GObject;
const Geocode = imports.gi.GeocodeGlib;
const Lang = imports.lang;

const Transportation = {
    CAR:        0,
    BIKE:       1,
    PEDESTRIAN: 2,
    TRANSIT:    3,

    toString: function (transportation) {
        switch(transportation) {
        case Transportation.CAR:        return 'car';
        case Transportation.BIKE:       return 'bike';
        case Transportation.PEDESTRIAN: return 'foot';
        case Transportation.TRANSIT:    return 'transit';
        default:                        return null;
        }
    }
};

const QueryPoint = new Lang.Class({
    Name: 'QueryPoint',
    Extends: GObject.Object,
    Properties: {
        'place': GObject.ParamSpec.object('place',
                                          '',
                                          '',
                                          GObject.ParamFlags.READABLE |
                                          GObject.ParamFlags.WRITABLE,
                                          Geocode.Place)
    },

    _init: function() {
        this._place = null;
        this.parent();
    },

    set place(p) {
        this._place = p;
        this.notify('place');
    },

    get place() {
        return this._place;
    }
});

const RouteQuery = new Lang.Class({
    Name: 'RouteQuery',
    Extends: GObject.Object,
    Signals: {
        'reset': { },
        'point-added': { param_types: [GObject.TYPE_OBJECT, GObject.TYPE_INT] },
        'point-removed': { param_types: [GObject.TYPE_OBJECT, GObject.TYPE_INT] }
    },
    Properties: {
        'points': GObject.ParamSpec.object('points',
                                           '',
                                           '',
                                           GObject.ParamFlags.READABLE |
                                           GObject.ParamFlags.WRITABLE,
                                           GObject.Object),
        'transportation': GObject.ParamSpec.int('transportation',
                                                '',
                                                '',
                                                GObject.ParamFlags.READABLE |
                                                GObject.ParamFlags.WRITABLE,
                                                Transportation.CAR,
                                                Transportation.PEDESTRIAN,
                                                Transportation.CAR,
                                                Transportation.TRANSIT)
    },

    get points() {
        return this._points;
    },

    set points(points) {
        this._points = points;
        this.notify('points');
    },

    get filledPoints() {
        return this.points.filter(function(point) {
            return point.place;
        });
    },

    _init: function(args) {
        this.parent(args);
        this._points = [];
        this.reset();
    },

    addPoint: function(index) {
        let point = new QueryPoint();

        if (index === -1)
            index = this.points.length - 1;

        this._points.splice(index, 0, point);
        point.connect('notify::place', (function() {
            this.notify('points');
        }).bind(this));
        this.notify('points');
        this.emit('point-added', point, index);

        return point;
    },

    removePoint: function(index) {
        let removedPoints = this._points.splice(index, 1);
        let point = removedPoints ? removedPoints[0] : null;

        if (point) {
            this.notify('points');
            this.emit('point-removed', point, index);
        }
    },

    set transportation(transportation) {
        this._transportation = transportation;
        this.notify('transportation');
        this.notify('points');
    },
    get transportation() {
        return this._transportation;
    },

    reset: function() {
        this.transportation = Transportation.CAR;
        this.freeze_notify();
        this._points.forEach(function(point) {
            point.place = null;
        });
        this.thaw_notify();
        this.emit('reset');
    },

    isValid: function() {
        if (this.filledPoints.length >= 2)
            return true;
        else
            return false;
    },

    toString: function() {
        return "\nPoints: " + this.points +
               "\nTransportation: " + this.transportation;
    }
});
