// based on https://github.com/Leimi/drawingboard.js

import { EventS }  from './Utils.js';
import '../shortcuts.js';

const defaultOpts = {
	controls: ['Color', 'DrawingMode', 'Size', 'Navigation'],
	color: "#000000",
	size: 10,
	eraserColor: "background",
    background: "#FFFFFF",
	fillTolerance: 100,
	fillHack: true, //try to prevent issues with anti-aliasing with a little hack by default
	webStorage: 'session',
	droppable: true,
	enlargeYourContainer: false,
	errorMessage: "<p>It seems you use an obsolete browser. <a href=\"http://browsehappy.com/\" target=\"_blank\">Update it</a> to start drawing.</p>",
	stretchImg: false //when setting the canvas img, strech the image at the whole canvas size when this opt is true
};

const mergeOptions = opts => {
	opts = Object.assign({}, defaultOpts, opts)

	if (!opts.background && opts.eraserColor === "background") {
		opts.eraserColor = "transparent";
	}

	return opts;
}

/**
 * pass the id of the html element to put the drawing board into
 * and some options : {
 *	controls: array of controls to initialize with the drawingboard. 'Colors', 'Size', and 'Navigation' by default
 *		instead of simple strings, you can pass an object to define a control opts
 *		ie ['Color', { Navigation: { reset: false }}]
 *	color: pencil color ("#000000" by default)
 *	size: pencil size (3 by default)
 *	webStorage: 'session', 'local' or false ('session' by default). store the current drawing in session or local storage and restore it when you come back
 *	droppable: true or false (false by default). If true, dropping an image on the canvas will include it and allow you to draw on it,
 *	errorMessage: html string to put in the board's element on browsers that don't support canvas.
 *	stretchImg: default behavior of image setting on the canvas: set to the canvas width/height or not? false by default
 * }
 */
function setup(id, opts) {
	this.opts = mergeOptions(opts);

	this.ev = EventS();

	this.id = id;
	this.$el = $('#' + id);

	if (!this.$el.length)
		return false;

	const borderColor = `border-color:${this.opts.borderColor}` || ""
	let tpl = `<div class="drawing-board-canvas-wrapper" style="${borderColor}">
	<canvas class="drawing-board-canvas">
	</canvas>
	<div class="drawing-board-cursor drawing-board-utils-hidden">
	</div>
	</div><div class="drawing-board-controls hide"></div>`;

	this.$el.addClass('drawing-board').append(tpl);
	
	this.dom = {
		$canvasWrapper: this.$el.find('.drawing-board-canvas-wrapper'),
		$canvas: this.$el.find('.drawing-board-canvas'),
		$cursor: this.$el.find('.drawing-board-cursor'),
		$controls: this.$el.find('.drawing-board-controls')
	};

	this.canvas = this.dom.$canvas.get(0);
	this.ctx = this.canvas && this.canvas.getContext && this.canvas.getContext('2d') ? this.canvas.getContext('2d') : null;
	this.color = this.opts.color;

	if (!this.ctx) {
		if (this.opts.errorMessage)
			this.$el.html(this.opts.errorMessage);
		return false;
	}

	this.storage = this._getStorage();

	this.initHistory();
	
	//init default board values before controls are added (mostly pencil color and size)
	this.reset({ webStorage: false, history: false, background: false });
	
	//init controls (they will need the default board values to work like pencil color and size)
	this.initControls();
	
	//set board's size after the controls div is added
	this.resize();

	//reset the board to take all resized space
	this.reset({ webStorage: false, history: false, background: true });
	this.restoreWebStorage();
	this.initDropEvents();
	this.initDrawEvents();
	this.initMouseEvents();
	this.initKeyboardEvents();
};

/**
 * Reset and Resize methods: put back the canvas to its default values
 *
 * depending on options, can set color, size, background back to default values
 * and store the reseted canvas in webstorage and history queue
 *
 * resize values depend on the `enlargeYourContainer` option
 */
const CanvasMethods = {
	reset(opts) {
		opts = Object.assign({
			color: this.opts.color,
			size: this.opts.size,
			webStorage: true,
			history: true,
			background: false
		}, opts);

		this.setMode('pencil');

		if (opts.background) {
			this.resetBackground(this.opts.background, function() {
				if (opts.history) this.saveHistory();
			}.bind(this));
		}

		if (opts.color) this.setColor(opts.color);
		if (opts.size) this.ctx.lineWidth = opts.size;

		this.ctx.lineCap = "round";
		this.ctx.lineJoin = "round";

		if (opts.webStorage) this.saveWebStorage();

		// if opts.background we already dealt with the history
		if (opts.history && !opts.background) this.saveHistory();

		this.blankCanvas = this.getImg();

		this.ev.trigger('board:reset', opts);
	},

	resetBackground(background, callback) {
		background = background || this.opts.background;

		var bgIsColor = DrawingBoard.Utils.isColor(background);
		var prevMode = this.getMode();
		this.setMode('pencil');
		this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
		if (bgIsColor) {
			this.ctx.fillStyle = background;
			this.ctx.fillRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
			this.history.initialize(this.getImg());
			if (callback) callback();
		} else if (background)
			this.setImg(background, {
				callback: function() {
					this.history.initialize(this.getImg());
					if (callback) callback();
				}.bind(this)
			});
		this.setMode(prevMode);
	},

	resize() {
		this.dom.$controls.toggleClass('drawing-board-controls-hidden', (!this.controls || !this.controls.length));

		var canvasWidth, canvasHeight;
		var widths = [
			this.$el.width(),
			DrawingBoard.Utils.boxBorderWidth(this.$el),
			DrawingBoard.Utils.boxBorderWidth(this.dom.$canvasWrapper, true, true)
		];
		var heights = [
			this.$el.height(),
			// I don't wanna count borders or controls height
			// DrawingBoard.Utils.boxBorderHeight(this.$el),
			// this.dom.$controls.height(),
			// DrawingBoard.Utils.boxBorderHeight(this.dom.$controls, false, true),
			DrawingBoard.Utils.boxBorderHeight(this.dom.$canvasWrapper, true, true)
		];

		var sum = function(values, multiplier) { //make the sum of all array values
			multiplier = multiplier || 1;
			var res = values[0];
			for (var i = 1; i < values.length; i++) {
				res = res + (values[i]*multiplier);
			}
			return res;
		};
		var sub = function(values) { return sum(values, -1); }; //substract all array values from the first one

		if (this.opts.enlargeYourContainer) {
			canvasWidth = this.$el.width();
			canvasHeight = this.$el.height();

			this.$el.width( sum(widths) );
			this.$el.height( sum(heights) );
		} else {
			canvasWidth = sub(widths);
			canvasHeight = sub(heights);
		}

		this.dom.$canvasWrapper.css('width', canvasWidth + 'px');
		this.dom.$canvasWrapper.css('height', canvasHeight + 'px');

		this.dom.$canvas.css('width', canvasWidth + 'px');
		this.dom.$canvas.css('height', canvasHeight + 'px');

		this.canvas.width = canvasWidth;
		this.canvas.height = canvasHeight;
	},

	draw() {
		//if the pencil size is big (>10), the small crosshair makes a friend: a circle of the size of the pencil
		//todo: have the circle works on every browser - it currently should be added only when CSS pointer-events are supported
		//we assume that if requestAnimationFrame is supported, pointer-events is too, but this is terribad.
		if (window.requestAnimationFrame && this.ctx.lineWidth > 10 && this.isMouseHovering) {
			this.dom.$cursor.css({ width: this.ctx.lineWidth + 'px', height: this.ctx.lineWidth + 'px' });
			
			
			const translateX = this.coords.current.x-(this.ctx.lineWidth/2)
			const translateY = this.coords.current.y-(this.ctx.lineWidth/2)
			var transform = `translateX(${translateX}px) translateY(${translateY}px)`;
			
			this.dom.$cursor.css({ 'transform': transform, '-webkit-transform': transform, '-ms-transform': transform });
			
			this.dom.$cursor.removeClass('drawing-board-utils-hidden');
		} else {
			this.dom.$cursor.addClass('drawing-board-utils-hidden');
		}

		if (this.isDrawing) {
			var currentMid = this._getMidInputCoords(this.coords.current);
			this.ctx.beginPath();
			this.ctx.moveTo(currentMid.x, currentMid.y);
			this.ctx.quadraticCurveTo(this.coords.old.x, this.coords.old.y, this.coords.oldMid.x, this.coords.oldMid.y);
			this.ctx.stroke();

			this.coords.old = this.coords.current;
			this.coords.oldMid = currentMid;
		}

		if (window.requestAnimationFrame) requestAnimationFrame( function() { this.draw(); }.bind(this) );
	},

	/**
	 * Fills an area with the current stroke color.
	 */
	fill(e) {
		if (this.getImg() === this.blankCanvas) {
			this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
			this.ctx.fillStyle = this.color;
			this.ctx.fillRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
			return;
		}

		var img = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);

		// constants identifying pixels components
		var INDEX = 0, X = 1, Y = 2, COLOR = 3;

		// target color components
		var stroke = this.ctx.strokeStyle;
		var r = parseInt(stroke.substr(1, 2), 16);
		var g = parseInt(stroke.substr(3, 2), 16);
		var b = parseInt(stroke.substr(5, 2), 16);

		// starting point
		var start = DrawingBoard.Utils.pixelAt(img, parseInt(e.coords.x, 10), parseInt(e.coords.y, 10));
		var startColor = start[COLOR];
		var tolerance = this.opts.fillTolerance;
		var useHack = this.opts.fillHack; //see https://github.com/Leimi/drawingboard.js/pull/38

		// no need to continue if starting and target colors are the same
		if (DrawingBoard.Utils.compareColors(startColor, DrawingBoard.Utils.RGBToInt(r, g, b), tolerance))
			return;

		// pixels to evaluate
		var queue = [start];

		// loop vars
		var pixel, x, y;
		var maxX = img.width - 1;
		var maxY = img.height - 1;

		function updatePixelColor(pixel) {
			img.data[pixel[INDEX]] = r;
			img.data[pixel[INDEX] + 1] = g;
			img.data[pixel[INDEX] + 2] = b;
		}

		while ((pixel = queue.pop())) {
			if (useHack)
				updatePixelColor(pixel);

			if (DrawingBoard.Utils.compareColors(pixel[COLOR], startColor, tolerance)) {
				if (!useHack)
					updatePixelColor(pixel);
				if (pixel[X] > 0) // west
					queue.push(DrawingBoard.Utils.pixelAt(img, pixel[X] - 1, pixel[Y]));
				if (pixel[X] < maxX) // east
					queue.push(DrawingBoard.Utils.pixelAt(img, pixel[X] + 1, pixel[Y]));
				if (pixel[Y] > 0) // north
					queue.push(DrawingBoard.Utils.pixelAt(img, pixel[X], pixel[Y] - 1));
				if (pixel[Y] < maxY) // south
					queue.push(DrawingBoard.Utils.pixelAt(img, pixel[X], pixel[Y] + 1));
			}
		}

		this.ctx.putImageData(img, 0, 0);
	},
}

/**
 * Controls:
 * the drawing board can has various UI elements to control it.
 * one control is represented by a class in the namespace DrawingBoard.Control
 * it must have a $el property (jQuery object), representing the html element to append on the drawing board at initialization.
 *
 */
const ControlsMethods = {
	initControls() {
		this.controls = [];
		if (!this.opts.controls.length || !DrawingBoard.Control) return false;
		for (var i = 0; i < this.opts.controls.length; i++) {
			var c = null;
			if (typeof this.opts.controls[i] == "string")
				c = new window['DrawingBoard']['Control'][this.opts.controls[i]](this);
			else if (typeof this.opts.controls[i] == "object") {
				for (var controlName in this.opts.controls[i]) break;
				c = new window['DrawingBoard']['Control'][controlName](this, this.opts.controls[i][controlName]);
			}
			if (c) {
				this.addControl(c);
			}
		}
	},

	//add a new control or an existing one at the position you want in the UI
	//to add a totally new control, you can pass a string with the js class as 1st parameter and control options as 2nd ie "addControl('Navigation', { reset: false }"
	//the last parameter (2nd or 3rd depending on the situation) is always the position you want to place the control at
	addControl(control, optsOrPos, pos) {
		if (typeof control !== "string" && (typeof control !== "object" || !control instanceof DrawingBoard.Control))
			return false;

		var opts = typeof optsOrPos == "object" ? optsOrPos : {};
		pos = pos ? pos*1 : (typeof optsOrPos == "number" ? optsOrPos : null);

		if (typeof control == "string")
			control = new window['DrawingBoard']['Control'][control](this, opts);

		if (pos)
			this.dom.$controls.children().eq(pos).before(control.$el);
		else
			this.dom.$controls.append(control.$el);

		if (!this.controls)
			this.controls = [];
		this.controls.push(control);
		this.dom.$controls.removeClass('drawing-board-controls-hidden');
	},
}

/**
 * Undo and redo drawed lines
 */
const HistoryMethods = {
	initHistory() {
		this.history = new SimpleUndo({
			maxLength: 30,
			provider: function(done) {
				done(this.getImg());
			}.bind(this),
			onUpdate: function() {
				this.ev.trigger('historyNavigation');
			}.bind(this)
		});
	},

	saveHistory() {
		this.history.save();
	},

	restoreHistory(image) {
		if (!image) {
			this.reset({background: true})
		}

		this.setImg(image, {
			callback: function() {
				this.saveWebStorage();
			}.bind(this) 
		});
	},

	goBackInHistory() {
		this.history.undo(this.restoreHistory.bind(this));
	},

	goForthInHistory() {
		this.history.redo(this.restoreHistory.bind(this));
	},
}

/**
 * You can directly put an image on the canvas, get it in base64 data url or start a download
 * 
 * Drop an image on the canvas to draw on it
 */
const ImageMethods = {
	setImg(src, opts) {
		opts = Object.assign({
			stretch: this.opts.stretchImg,
			callback: null
		}, opts);

		var ctx = this.ctx;
		var img = new Image();
		var oldGCO = ctx.globalCompositeOperation;
		img.onload = function() {
			ctx.globalCompositeOperation = "source-over";
			ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

			if (opts.stretch) {
				ctx.drawImage(img, 0, 0, ctx.canvas.width, ctx.canvas.height);
			} else {
				ctx.drawImage(img, 0, 0);
			}

			ctx.globalCompositeOperation = oldGCO;

			if (opts.callback) {
				opts.callback();
			}
		};
		img.src = src;
	},

	getImg() {
		return this.canvas.toDataURL("image/png");
	},

	downloadImg() {
		var img = this.getImg();
		img = img.replace("image/png", "image/octet-stream");
		window.location.href = img;
	},

	initDropEvents() {
		if (!this.opts.droppable)
			return false;

		this.dom.$canvas.on('dragover dragenter drop', function(e) {
			e.stopPropagation();
			e.preventDefault();
		});

		this.dom.$canvas.on('drop', this._onCanvasDrop.bind(this));
	},

	_onCanvasDrop(e) {
		e = e.originalEvent ? e.originalEvent : e;
		var files = e.dataTransfer.files;
		if (!files || !files.length || files[0].type.indexOf('image') == -1 || !window.FileReader)
			return false;
		var fr = new FileReader();
		fr.readAsDataURL(files[0]);
		fr.onload = function(ev) {
			this.setImg(ev.target.result, {
				callback: function() {
					this.saveHistory();
				}.bind(this)
			});
			this.ev.trigger('board:imageDropped', ev.target.result);
			this.ev.trigger('board:userAction');
		}.bind(this);
	},
}

/**
 * Save and restore to local or session storage
 */
const WebStorageMethods = {
	saveWebStorage() {
		if (window[this.storage]) {
			window[this.storage].setItem('drawing-board-' + this.id, this.getImg());
			this.ev.trigger('board:save' + this.storage.charAt(0).toUpperCase() + this.storage.slice(1), this.getImg());
		}
	},

	restoreWebStorage() {
		if (window[this.storage] && window[this.storage].getItem('drawing-board-' + this.id) !== null) {
			this.setImg(window[this.storage].getItem('drawing-board-' + this.id));
			this.ev.trigger('board:restore' + this.storage.charAt(0).toUpperCase() + this.storage.slice(1), window[this.storage].getItem('drawing-board-' + this.id));
		}
	},

	clearWebStorage() {
		if (window[this.storage] && window[this.storage].getItem('drawing-board-' + this.id) !== null) {
			window[this.storage].removeItem('drawing-board-' + this.id);
			this.ev.trigger('board:clear' + this.storage.charAt(0).toUpperCase() + this.storage.slice(1));
		}
	},

	_getStorage() {
		if (!this.opts.webStorage || !(this.opts.webStorage === 'session' || this.opts.webStorage === 'local')) return false;
		return this.opts.webStorage + 'Storage';
	},
}

/**
 * Mouse and Keyboard Events
 */
const IOMethods = {
	initMouseEvents() {
		this.dom.$canvas.on('contextmenu', function(e) {
			e.stopPropagation();
			e.preventDefault();
		});

		this.dom.$canvas.on('contextmenu', this._onCanvasRightClick.bind(this));
	},

	_onCanvasRightClick(e) {
		e = e.originalEvent ? e.originalEvent : e;

		const controls = this.dom.$controls[0]

		this.dom.$controls[0].classList.remove('hide')
		
		controls.style.left = e.pageX + "px"
		controls.style.top = e.pageY + "px"
		
	},

	initKeyboardEvents() {
 
		const { redo, undo, clear, toggleOptions } = window.shortcuts

		Mousetrap.bind(clear, function() {
			this.reset({ background: true })
		}.bind(this))

		Mousetrap.bind(undo, function() {
			this.goBackInHistory()
		}.bind(this))

		Mousetrap.bind(redo, function() {
			this.goForthInHistory()
		}.bind(this))

		Mousetrap.bind(toggleOptions, function() {
			this.dom.$controls[0].classList.toggle('hide')
		}.bind(this))

	},

	/**
	 * Drawing handling, with mouse or touch
	 */

	initDrawEvents() {
		this.isDrawing = false
		this.isMouseHovering = false
		this.coords = {}
		this.coords.old = this.coords.current = this.coords.oldMid = { x: 0, y: 0 }

		this.dom.$canvas.on('mousedown touchstart', function(e) {
			const leftClick = e.button === 0
			const isTouch = e.originalEvent.type === "touchstart"
			const isOneFingerTouch = e.originalEvent.touches?.length === 1

			if (leftClick || isTouch && isOneFingerTouch) {
				const hideControls = () => this.dom.$controls[0].classList.add('hide')
				hideControls()

				this._onInputStart(e, this._getInputCoords(e) )
			}
		}.bind(this))

		this.dom.$canvas.on('mousemove touchmove', function(e) {
			this._onInputMove(e, this._getInputCoords(e) );
		}.bind(this))

		this.dom.$canvas.on('mousemove', function(e) {

		}.bind(this));

		this.dom.$canvas.on('mouseup touchend', function(e) {
			this._onInputStop(e, this._getInputCoords(e) );
		}.bind(this));

		this.dom.$canvas.on('mouseover', function(e) {
			this._onMouseOver(e, this._getInputCoords(e) );
		}.bind(this));

		this.dom.$canvas.on('mouseout', function(e) {
			this._onMouseOut(e, this._getInputCoords(e) );

		}.bind(this));

		$('body').on('mouseup touchend', function(e) {
			this.isDrawing = false;
		}.bind(this));

		if (window.requestAnimationFrame) requestAnimationFrame( this.draw.bind(this) );
	},

	_onInputStart(e, coords) {
		this.coords.current = this.coords.old = coords;
		this.coords.oldMid = this._getMidInputCoords(coords);
		this.isDrawing = true;

		if (!window.requestAnimationFrame) this.draw();

		this.ev.trigger('board:startDrawing', {e: e, coords: coords});
		e.stopPropagation();
		e.preventDefault();
	},

	_onInputMove(e, coords) {
		this.coords.current = coords;
		this.ev.trigger('board:drawing', {e: e, coords: coords});

		if (!window.requestAnimationFrame) this.draw();

		e.stopPropagation();
		e.preventDefault();
	},

	_onInputStop(e, coords) {
		if (this.isDrawing && (!e.touches || e.touches.length === 0)) {
			this.isDrawing = false;

			this.saveWebStorage();
			this.saveHistory();

			this.ev.trigger('board:stopDrawing', {e: e, coords: coords});
			this.ev.trigger('board:userAction');
			e.stopPropagation();
			e.preventDefault();
		}
	},

	_onMouseOver(e, coords) {
		this.isMouseHovering = true;
		this.coords.old = this._getInputCoords(e);
		this.coords.oldMid = this._getMidInputCoords(this.coords.old);

		this.ev.trigger('board:mouseOver', {e: e, coords: coords});
	},

	_onMouseOut(e, coords) {
		this.isMouseHovering = false;

		this.ev.trigger('board:mouseOut', {e: e, coords: coords});
	},

	_getInputCoords(e) {
		e = e.originalEvent ? e.originalEvent : e;
		var
			rect = this.canvas.getBoundingClientRect(),
			width = this.dom.$canvas.width(),
			height = this.dom.$canvas.height()
		;
		var x, y;
		if (e.touches && e.touches.length == 1) {
			x = e.touches[0].pageX;
			y = e.touches[0].pageY;
		} else {
			x = e.pageX;
			y = e.pageY;
		}
		x = x - this.dom.$canvas.offset().left;
		y = y - this.dom.$canvas.offset().top;
		x *= (width / rect.width);
		y *= (height / rect.height);
		return {
			x: x,
			y: y
		};
	},

	_getMidInputCoords(coords) {
		return {
			x: this.coords.old.x + coords.x>>1,
			y: this.coords.old.y + coords.y>>1
		};
	}

}

/**
 * set and get current drawing mode
 *
 * possible modes are "pencil" (draw normally), "eraser" (draw transparent, like, erase, you know), "filler" (paint can)
 */
const DrawingModesMethods = {
	setMode(newMode, silent) {
		silent = silent || false;
		newMode = newMode || 'pencil';

		this.ev.unbind('board:startDrawing', this.fill.bind(this));

		if (this.opts.eraserColor === "transparent")
			this.ctx.globalCompositeOperation = newMode === "eraser" ? "destination-out" : "source-over";
		else {
			if (newMode === "eraser") {
				if (this.opts.eraserColor === "background" && DrawingBoard.Utils.isColor(this.opts.background))
					this.ctx.strokeStyle = this.opts.background;
				else if (DrawingBoard.Utils.isColor(this.opts.eraserColor))
					this.ctx.strokeStyle = this.opts.eraserColor;
			} else if (!this.mode || this.mode === "eraser") {
				this.ctx.strokeStyle = this.color;
			}

			if (newMode === "filler")
				this.ev.bind('board:startDrawing', this.fill.bind(this));
		}
		this.mode = newMode;
		if (!silent)
			this.ev.trigger('board:mode', this.mode);
	},

	getMode() {
		return this.mode || "pencil";
	},

	setColor(color) {
		var that = this;
		color = color || this.color;
		if (!DrawingBoard.Utils.isColor(color))
			return false;
		this.color = color;
		if (this.opts.eraserColor !== "transparent" && this.mode === "eraser") {
			var setStrokeStyle = function(mode) {
				if (mode !== "eraser")
					that.strokeStyle = that.color;
				that.ev.unbind('board:mode', setStrokeStyle);
			};
			this.ev.bind('board:mode', setStrokeStyle);
		} else
			this.ctx.strokeStyle = this.color;
	},
}

/* 
	Let's create the DrawingBoard
*/
window.DrawingBoard = typeof DrawingBoard !== "undefined" ? DrawingBoard : {};

DrawingBoard.Board = setup
DrawingBoard.Board.prototype = {
	...CanvasMethods,
	...ControlsMethods,
	...HistoryMethods,
	...ImageMethods,
	...WebStorageMethods,
	...IOMethods,
	...DrawingModesMethods,
};
