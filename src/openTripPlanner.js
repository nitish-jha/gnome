/* -*- Mode: JS2; indent-tabs-mode: nil; js2-basic-offset: 4 -*- */
/* vim: set et ts=4 sw=4: */
/*
 * Copyright (c) 2016 Marcus Lundblad
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
 * Author: Marcus Lundblad <ml@update.uu.se>
 */

const Lang = imports.lang;

const Soup = imports.gi.Soup;

const Application = imports.application;
const HTTP = imports.http;
const RouteQuery = imports.routeQuery;
const Utils = imports.utils;

/* base URL used for testing against a local OTP instance for now */
const _BASE_URL = 'http://localhost:8080/otp';

/* timeout after which the routers data is considered stale and we will force
   a reload (24 hours) */
const _ROUTERS_TIMEOUT = 24 * 60 * 60;

const OpenTripPlanner = new Lang.Class({
    Name: 'OpenTripPlanner',

    _init: function() {
        this._session = new Soup.Session();
        /* initially set routers as updated far back in the past to force
           a download when first request */
        this._routersUpdatedTimestamp = 0;
        this._query = Application.routeQuery;
    },

    connect: function() {
        this._signalHandler = this._query.connect('notify::points', (function() {
            if (this._query.isValid())
                this.fetchRoute(this._query.filledPoints);
        }).bind(this));
    },

    disconnect: function() {
        if (this._signalHandler !== 0) {
            this._query.disconnect(this._signalHandler);
            this._signalHandler = 0;
        }
    },

    _fetchRouters: function(callback) {
        let currentTime = (new Date()).getTime();

        if (currentTime - this._routersUpdatedTimestamp < _ROUTERS_TIMEOUT) {
            callback(true);
        } else {
            let uri = new Soup.URI(_BASE_URL + '/routers');
            let request = new Soup.Message({ method: 'GET', uri: uri });

            request.request_headers.append('Accept', 'application/json');
            this._session.queue_message(request, (function(obj, message) {
                if (message.status_code !== Soup.Status.OK) {
                    callback(false);
                    return;
                }

                Utils.debug('routers: ' + message.response_body.data);
                try {
                    this._routers = JSON.parse(message.response_body.data);
                    this._routersUpdatedTimestamp = (new Date()).getTime();
                    callback(true);
                } catch (e) {
                    Utils.debug('Failed to parse router information');
                    callback(false);
                }
            }).bind(this));
        }
    },

    _getRoutersForPlace: function(place) {
        let routers = [];

        Utils.debug('_getRotersForPlace');
        Utils.debug('place coords: ' + place.location.latitude + ', ' + place.location.longitude);

        this._routers.routerInfo.forEach((function(routerInfo) {
            Utils.debug('checking router: ' + routerInfo.routerId);

            /* TODO: only check bounding rectangle for now
               should we try to do a finer-grained check using the bounding
               polygon (if OTP gives one for the routers).
               And should we add some margins to allow routing from just outside
               a network (walking distance)? */
            if (place.location.latitude >= routerInfo.lowerLeftLatitude &&
                place.location.latitude <= routerInfo.upperRightLatitude &&
                place.location.longitude >= routerInfo.lowerLeftLongitude &&
                place.location.longitude <= routerInfo.upperRightLongitude)
                routers.push(routerInfo.routerId);
        }));

        return routers;
    },

    /* Note: this is theoretically slow (O(n*m)), but we will have filtered
       possible routers for the starting and ending query point, so they should
       be short (in many cases just one element) */
    _routerIntersection: function(routers1, routers2) {
        return routers1.filter(function(n) {
            return routers2.indexOf(n) != -1;
        });
    },

    _fetchRoutesRecursive: function(points, routers, index, result, callback) {
        let params = {fromPlace: points[0].place.location.latitude + ',' +
                                 points[0].place.location.longitude,
                      toPlace: points[points.length - 1].place.location.latitude +
                               ',' +
                               points[points.length - 1].place.location.longitude
                      };

        Utils.debug('fetching plans for router with index ' + index);

        let intermediatePlaces = [];
        for (let i = 1; i < points.length - 2; i++) {
            intermediatePlaces.push(points[i].place.location.latitude + ',' +
                                    points[i].place.location.longitude);
        }
        if (intermediatePlaces.length > 0)
            params.intermediatePlaces = intermediatePlaces;

        let query = new HTTP.Query(params);
        let uri = new Soup.URI(_BASE_URL + '/routers/' + routers[index] +
                               '/plan?' + query.toString());
        let request = new Soup.Message({ method: 'GET', uri: uri });

        Utils.debug('URI: ' + uri.to_string(true));

        request.request_headers.append('Accept', 'application/json');
        this._session.queue_message(request, (function(obj, message) {
            if (message.status_code !== Soup.Status.OK)
                Utils.debug('Failed to get route plan from router ' +
                            routers[index]);
            else
                result.push(JSON.parse(message.response_body.data))

            if (index < routers.length - 1)
                this._fetchRoutesRecursive(points, routers, index + 1, result,
                                           callback);
            else
                callback(result);
        }).bind(this));
    },

    _fetchRoutes: function(points, routers, callback) {
        this._fetchRoutesRecursive(points, routers, 0, [], callback);
    },

    fetchRoute: function(points) {
        this._fetchRouters((function(success) {
            if (success) {
                let routers = this._getRoutersForPoints(points);

                if (routers.length > 0) {
                    Utils.debug('about to fetch routes');
                    this._fetchRoutes(points, routers, (function(routes) {
                        routes.forEach(function(plan) {
                            Utils.debug('plan: ' + JSON.stringify(plan));
                        })
                    }).bind(this));
                } else {
                    Application.notificationManager.showMessage(_("No route found."));
                }
            } else {
                Application.notificationManager.showMessage(_("Route request failed."));
            }
        }).bind(this));
    },

    _getRoutersForPoints: function(points) {
        Utils.debug('sucessfully fetched routers list, points.length ' + points.length);
        let startRouters = this._getRoutersForPlace(points[0].place);
        let endRouters =
            this._getRoutersForPlace(points[points.length - 1].place);

        Utils.debug('routers at start point: ' + startRouters);
        Utils.debug('routers at end point: ' + endRouters);
        let intersectingRouters =
            this._routerIntersection(startRouters, endRouters);

        Utils.debug('intersecting routers: ' + intersectingRouters);

        return intersectingRouters;
    }
})
