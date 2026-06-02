extends Control

@export var label_text: String = "A"
@export var fill_color: Color = Color(1.0, 0.85, 0.25, 0.85)

const RADIUS := 56.0

signal pressed
signal released

var _down := false

func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_STOP
	custom_minimum_size = Vector2(RADIUS * 2.0, RADIUS * 2.0)

func _draw() -> void:
	var center := size * 0.5
	var c := fill_color
	if _down:
		c = Color(c.r * 0.7, c.g * 0.7, c.b * 0.7, c.a)
	draw_circle(center, RADIUS, c)
	draw_arc(center, RADIUS, 0, TAU, 48, Color(0, 0, 0, 0.85), 3.0)
	var fnt := ThemeDB.fallback_font
	var fsize := 30
	var ts := fnt.get_string_size(label_text, HORIZONTAL_ALIGNMENT_CENTER, -1, fsize)
	draw_string(fnt, center - ts * 0.5 + Vector2(0, ts.y * 0.35), label_text, HORIZONTAL_ALIGNMENT_CENTER, -1, fsize, Color(0.1, 0.05, 0.0, 1))

func _gui_input(event: InputEvent) -> void:
	if event is InputEventScreenTouch:
		if event.pressed:
			_down = true
			pressed.emit()
		else:
			_down = false
			released.emit()
		queue_redraw()
		accept_event()
	elif event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		if event.pressed:
			_down = true
			pressed.emit()
		else:
			_down = false
			released.emit()
		queue_redraw()
		accept_event()
