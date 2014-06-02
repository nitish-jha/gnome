/* -*- Mode: JS2; indent-tabs-mode: nil; js2-basic-offset: 4 -*- */
/* vim: set et ts=4 sw=4: */
/*
 * Copyright (c) 2014 Damián Nohales
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
 * with GNOME Maps; if not, write to the Free Software Foundation,
 * Inc., 51 Franklin St, Fifth Floor, Boston, MA  02110-1301  USA
 *
 * Author: Damián Nohales <damiannohales@gmail.com>
 */

const Geocode = imports.gi.GeocodeGlib;
const GObject = imports.gi.GObject;
const Lang = imports.lang;

const SocialPlace = new Lang.Class({
    Name: 'SocialServiceSocialPlace',
    Extends: GObject.Object,

    _init: function(params) {
        this.parent();

        this.id = params.id;
        this.name = params.name;
        this.latitude = params.latitude;
        this.longitude = params.longitude;
        this.category = params.category;
        this.link = params.link;
        this.originalData = params.originalData;
    },

    get location() {
        return new Geocode.Location({ latitude: parseFloat(this.latitude),
                                      longitude: parseFloat(this.longitude) });
    }
});
