/* -*- Mode: JS2; indent-tabs-mode: nil; js2-basic-offset: 4 -*- */
/* vim: set et ts=4 sw=4: */
/*
 * Copyright (c) 2011, 2012, 2013 Red Hat, Inc.
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
 * Author: Zeeshan Ali (Khattak) <zeeshanak@gnome.org>
 *         Mattias Bengtsson <mattias.jc.bengtsson@gmail.com>
 */

const Cairo = imports.cairo;
const Gdk = imports.gi.Gdk;
const GObject = imports.gi.GObject;
const Gtk = imports.gi.Gtk;
const Lang = imports.lang;
const Mainloop = imports.mainloop;

const Application = imports.application;
const InstructionRow = imports.instructionRow;
const PlaceStore  = imports.placeStore;
const RouteEntry = imports.routeEntry;
const RouteQuery = imports.routeQuery;
const StoredRoute = imports.storedRoute;
const Utils = imports.utils;

const Sidebar = new Lang.Class({
    Name: 'Sidebar',
    Extends: Gtk.Revealer,
    Template: 'resource:///org/gnome/Maps/ui/sidebar.ui',
    InternalChildren: [ 'distanceInfo',
                        'entryList',
                        'instructionList',
                        'instructionWindow',
                        'instructionSpinner',
                        'instructionStack',
                        'modeBikeToggle',
                        'modeCarToggle',
                        'modePedestrianToggle',
                        'modeTransitToggle',
                        'timeInfo' ],

    _init: function(mapView) {
        this.parent({ transition_type: Gtk.RevealerTransitionType.SLIDE_LEFT });

        this._mapView = mapView;

        Utils.debug('before _initInstructionList');

        this._query = Application.routeQuery;
        this._initInstructionList();

        Utils.debug('after _initInstructionList');

        this._initTransportationToggles(this._modePedestrianToggle,
                                        this._modeBikeToggle,
                                        this._modeCarToggle,
                                        this._modeTransitToggle);

        this._initQuerySignals();

        Utils.debug('after creating query');

        this._query.addPoint(0);
        this._query.addPoint(1);
        this._switchRoutingMode();
    },

    _initTransportationToggles: function(pedestrian, bike, car, transit) {
        let transport = RouteQuery.Transportation;

        let onToggle = function(mode, button) {
            Utils.debug('onToggle: ' + mode + ', query.mode: ' + this._query.transportation);

            let previousMode = this._query.transportation;

            /* if the transportation mode changes to/from transit
               change the routing engine */
            if (button.active &&
                ((mode !== transport.TRANSIT
                  && previousMode === transport.TRANSIT)
                 || (mode === transport.TRANSIT
                     && previousMode !== transport.TRANSIT))) {
                Utils.debug('switching routing mode');
                this._switchRoutingMode(mode);
            }

            if (button.active && previousMode !== mode)
                this._query.transportation = mode;

            /*
            if (button.active && mode === transport.TRANSIT) {
                let openTripPlanner = Application.openTripPlanner;

                openTripPlanner.fetchRouters(function(status, body) {
                    Utils.debug('fetched routers: ' + status);
                });
            }
            */
        };
        pedestrian.connect('toggled', onToggle.bind(this, transport.PEDESTRIAN));
        car.connect('toggled', onToggle.bind(this, transport.CAR));
        bike.connect('toggled', onToggle.bind(this, transport.BIKE));
        transit.connect('toggled', onToggle.bind(this, transport.TRANSIT))

        let setToggles = function() {
            switch(Application.routeQuery.transportation) {
            case transport.PEDESTRIAN:
                pedestrian.active = true;
                break;
            case transport.CAR:
                car.active = true;
                break;
            case transport.BIKE:
                bike.active = true;
                break;
            case transport.TRANSIT:
                transit.active = true;
                break;
            }
        };

        setToggles();
        this._query.connect('notify::transportation', setToggles);
    },

    _switchRoutingMode: function(mode) {
        let graphHopper = Application.routeService;
        let openTripPlanner = Application.openTripPlanner;

        if (mode === RouteQuery.Transportation.TRANSIT) {
            Utils.debug('switching to transit');
            graphHopper.disconnect();
            openTripPlanner.connect();
        } else {
            Utils.debug('switch from transit');
            openTripPlanner.disconnect();
            graphHopper.connect();
        }
    },

    _initQuerySignals: function() {
        this._query.connect('point-added', (function(obj, point, index) {
            this._createRouteEntry(index, point);
        }).bind(this));

        this._query.connect('point-removed', (function(obj, point, index) {
            let row = this._entryList.get_row_at_index(index);
            row.destroy();
        }).bind(this));
    },

    _cancelStore: function() {
        Mainloop.source_remove(this._storeRouteTimeoutId);
        this._storeRouteTimeoutId = 0;
    },

    _createRouteEntry: function(index, point) {
        let type;
        if (index === 0)
            type = RouteEntry.Type.FROM;
        else if (index === this._entryList.get_children().length)
            type = RouteEntry.Type.TO;
        else
            type = RouteEntry.Type.VIA;

        let routeEntry = new RouteEntry.RouteEntry({ type: type,
                                                     point: point,
                                                     mapView: this._mapView });
        this._entryList.insert(routeEntry, index);

        if (type === RouteEntry.Type.FROM) {
            routeEntry.button.connect('clicked', (function() {
                let lastIndex = this._entryList.get_children().length;
                this._query.addPoint(lastIndex - 1);
            }).bind(this));

            this.bind_property('child-revealed',
                               routeEntry.entry, 'has_focus',
                               GObject.BindingFlags.DEFAULT);
        } else if (type === RouteEntry.Type.VIA) {
            routeEntry.button.connect('clicked', function() {
                let row = routeEntry.get_parent();
                this._query.removePoint(row.get_index());
            });
        }

        this._initRouteDragAndDrop(routeEntry);
    },

    _initInstructionList: function() {
        let route = Application.routeService.route;

        route.connect('reset', (function() {
            this._clearInstructions();
            this._instructionStack.visible_child = this._instructionWindow;

            let length = this._entryList.get_children().length;
            for (let index = 1; index < (length - 1); index++) {
                this._query.removePoint(index);
            }
        }).bind(this));

        this._query.connect('notify', (function() {
            if (this._query.isValid())
                this._instructionStack.visible_child = this._instructionSpinner;
            else
                this._clearInstructions();

            if (this._storeRouteTimeoutId)
                this._cancelStore();

        }).bind(this));

        route.connect('update', (function() {
            this._clearInstructions();
            this._instructionStack.visible_child = this._instructionWindow;

            if (this._storeRouteTimeoutId)
                this._cancelStore();

            this._storeRouteTimeoutId = Mainloop.timeout_add(5000, (function() {
                let placeStore = Application.placeStore;
                let places = this._query.filledPoints.map(function(point) {
                    return point.place;
                });
                let storedRoute = new StoredRoute.StoredRoute({
                    transportation: this._query.transportation,
                    route: route,
                    places: places,
                    geoclue: Application.geoclue
                });

                if (!storedRoute.containsNull) {
                    placeStore.addPlace(storedRoute,
                                        PlaceStore.PlaceType.RECENT_ROUTE);
                }
                this._storeRouteTimeoutId = 0;
            }).bind(this));

            route.turnPoints.forEach((function(turnPoint) {
                let row = new InstructionRow.InstructionRow({ visible: true,
                                                              turnPoint: turnPoint });
                this._instructionList.add(row);
            }).bind(this));

            /* Translators: %s is a time expression with the format "%f h" or "%f min" */
            this._timeInfo.label = _("Estimated time: %s").format(Utils.prettyTime(route.time));
            this._distanceInfo.label = Utils.prettyDistance(route.distance);
        }).bind(this));

        this._instructionList.connect('row-selected',(function(listbox, row) {
            if (row)
                this._mapView.showTurnPoint(row.turnPoint);
        }).bind(this));
    },

    _clearInstructions: function() {
        let listBox = this._instructionList;
        listBox.forall(listBox.remove.bind(listBox));

        this._timeInfo.label = '';
        this._distanceInfo.label = '';
    },

    // Iterate over points and establish the new order of places
    _reorderRoutePoints: function(srcIndex, destIndex) {
        let points = query.points;
        let srcPlace = this._draggedPoint.place;

        // Determine if we are swapping from "above" or "below"
        let step = (srcIndex < destIndex) ? -1 : 1;

        // Hold off on notifying the changes to query.points until
        // we have re-arranged the places.
        this._query.freeze_notify();

        for (let i = destIndex; i !== (srcIndex + step); i += step) {
            // swap
            [points[i].place, srcPlace] = [srcPlace, points[i].place];
        }

        this._query.thaw_notify();
    },

    _onDragDrop: function(row, context, x, y, time) {
        let srcIndex = this._query.points.indexOf(this._draggedPoint);
        let destIndex = row.get_index();

        this._reorderRoutePoints(srcIndex, destIndex);
        Gtk.drag_finish(context, true, false, time);
        return true;
    },

    _dragHighlightRow: function(row) {
        row.opacity = 0.6;
    },

    _dragUnhighlightRow: function(row) {
        row.opacity = 1.0;
    },

    // Set the opacity of the row we are currently dragging above
    // to semi transparent.
    _onDragMotion: function(row, context, x, y, time) {
        let routeEntry = row.get_child();

        if (this._draggedPoint && this._draggedPoint !== routeEntry.point) {
            this._dragHighlightRow(row);
            Gdk.drag_status(context, Gdk.DragAction.MOVE, time);
        } else
            Gdk.drag_status(context, 0, time);
        return true;
    },

    // Drag ends, show the dragged row again.
    _onDragEnd: function(context, row) {
        this._draggedPoint = null;

        // Restore to natural height
        row.height_request = -1;
        row.get_child().show();
    },

    // Drag begins, set the correct drag icon and hide the dragged row.
    _onDragBegin: function(context, row) {
        let routeEntry = row.get_child();
        let dragEntry = this._dragWidget.get_child();

        this._draggedPoint = routeEntry.point;

        // Set a fixed height on the row to prevent the sidebar height
        // to shrink while dragging a row.
        let height = row.get_allocated_height();
        row.height_request = height;
        row.get_child().hide();

        dragEntry.entry.text = routeEntry.entry.text;
        Gtk.drag_set_icon_surface(context,
                                  this._dragWidget.get_surface(), 0, 0);
    },

    // We add RouteEntry to an OffscreenWindow and paint the background
    // of the entry to be transparent. We can later use the GtkOffscreenWindow
    // method get_surface to generate our drag icon.
    _initDragWidget: function() {
        let dragEntry = new RouteEntry.RouteEntry({ type: RouteEntry.Type.TO,
                                                    name: 'dragged-entry',
                                                    app_paintable: true });
        this._dragWidget = new Gtk.OffscreenWindow({ visible: true });

        dragEntry.connect('draw', (function(widget, cr) {
            cr.setSourceRGBA(0.0, 0.0, 0.0, 0.0);
            cr.setOperator(Cairo.Operator.SOURCE);
            cr.paint();
            cr.setOperator(Cairo.Operator.OVER);
        }).bind(this));

        this._dragWidget.add(dragEntry);
    },

    // Set up drag and drop between RouteEntrys. The drag source is from a
    // GtkEventBox that contains the start/end icon next in the entry. And
    // the drag destination is the ListBox row.
    _initRouteDragAndDrop: function(routeEntry) {
        let dragIcon = routeEntry.iconEventBox;
        let row = routeEntry.get_parent();

        dragIcon.drag_source_set(Gdk.ModifierType.BUTTON1_MASK,
                                 null,
                                 Gdk.DragAction.MOVE);
        dragIcon.drag_source_add_image_targets();

        row.drag_dest_set(Gtk.DestDefaults.MOTION,
                          null,
                          Gdk.DragAction.MOVE);
        row.drag_dest_add_image_targets();

        dragIcon.connect('drag-begin', (function(icon, context) {
            this._onDragBegin(context, row);
        }).bind(this));
        dragIcon.connect('drag-end', (function(icon, context) {
            this._onDragEnd(context, row);
        }).bind(this));

        row.connect('drag-leave', this._dragUnhighlightRow.bind(this, row));
        row.connect('drag-motion', this._onDragMotion.bind(this));
        row.connect('drag-drop', this._onDragDrop.bind(this));

        this._initDragWidget();
    }
});
