/* -*- Mode: JS2; indent-tabs-mode: nil; js2-basic-offset: 4 -*- */
/* vim: set et ts=4 sw=4: */
/*
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
 * Author: Amisha Singla <amishas157@gmail.com>
 */

const Gtk = imports.gi.Gtk;
const Lang = imports.lang;
const Mainloop = imports.mainloop;

const Application = imports.application;
const PrintLayout = imports.printLayout;
const Utils = imports.utils;

const _MIN_TIME_TO_ABORT = 3000;

const PrintOperation = new Lang.Class({
    Name: 'PrintOperation',

    _init: function(params) {
        this._mainWindow = params.mainWindow;
        delete params.mainWindow;

        this._operation = new Gtk.PrintOperation({ embed_page_setup: true });
        this._operation.connect('begin-print', this._beginPrint.bind(this));
        this._operation.connect('paginate', this._paginate.bind(this));
        this._operation.connect('draw-page', this._drawPage.bind(this));

        this._abortDialog = new Gtk.MessageDialog({
            transient_for: this._mainWindow,
            destroy_with_parent: true,
            message_type: Gtk.MessageType.OTHER,
            modal: true,
            text: _("Loading map tiles for printing"),
            secondary_text: _("You can abort printing if this takes too long")
        });
        this._abortDialog.add_button(_("Abort printing"),
                                     Gtk.ResponseType.CANCEL);
        this._responseId = this._abortDialog.connect('response',
                                                     this.onAbortDialogResponse.bind(this));

        this._runPrintOperation();
    },

    _beginPrint: function(operation, context, data) {
        let route = Application.routeService.route;
        let width = context.get_width();
        let height = context.get_height();

        Mainloop.timeout_add(_MIN_TIME_TO_ABORT, (function() {
            if (this._operation.get_status() !== Gtk.PrintStatus.FINISHED) {
                this._abortDialog.show();
            }
            return false;
        }).bind(this), null);

        this._layout = PrintLayout.newFromRoute(route, width, height);
        this._layout.render();
    },

    onAbortDialogResponse: function(dialog, response) {
        if (response === Gtk.ResponseType.DELETE_EVENT ||
            response === Gtk.ResponseType.CANCEL) {
            this._abortDialog.disconnect(this._responseId);
            this._operation.cancel();
            this._abortDialog.close();
        }
    },

    _paginate: function(operation, context) {
        if (this._layout.renderFinished) {
            operation.set_n_pages(this._layout.numPages);
            this._abortDialog.close();
        }
        return this._layout.renderFinished;
    },

    _drawPage: function(operation, context, page_num, data) {
        let cr = context.get_cairo_context();
        this._layout.surfaceObjects[page_num].forEach((function(so) {
            cr.setSourceSurface(so.surface, so.x, so.y);
            cr.paint();
        }).bind(this));
    },

    _runPrintOperation: function() {
        let result = this._operation.run(Gtk.PrintOperationAction.PRINT_DIALOG,
                                         this._mainWindow, null);

        if (result === Gtk.PrintOperationResult.ERROR) {
            let error = this._operation.get_error();
            Utils.debug('Failed to print: %s'.format(error));
        }
    }
});
