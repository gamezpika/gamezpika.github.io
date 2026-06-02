extends Control

const BASE_RADIUS := 90.0
const STICK_RADIUS := 38.0
const MAX_OFFSET := 70.0
const DEADZONE := 0.18

var _touch_index := -1
var _stick_offset := Vector2.ZERO
var value: Vector2 = Vector2.ZERO

func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_STOP
	custom_minimum_size = Vector2(BASE_RADIUS * 2.0, BASE_RADIUS * 2.0)

func _draw() -> void:
	var center := size * 0.5
	draw_circle(center, BASE_RADIUS, Color(0, 0, 0, 0.28))
	draw_arc(center, BASE_RADIUS, 0, TAU, 64, Color(1, 1, 1, 0.55), 3.0)
	draw_circle(center + _stick_offset, STICK_RADIUS, Color(1, 1, 1, 0.7))
	draw_arc(center + _stick_offset, STICK_RADIUS, 0, TAU, 32, Color(0.1, 0.1, 0.1, 0.7), 2.0)

func _gui_input(event: InputEvent) -> void:
	var center := size * 0.5
	if event is InputEventScreenTouch:
		var t: InputEventScreenTouch = event
		if t.pressed and _touch_index == -1:
			_touch_index = t.index
			_update_stick(t.position - center)
			accept_event()
		elif (not t.pressed) and t.index == _touch_index:
			_touch_index = -1
			_update_stick(Vector2.ZERO)
			accept_event()
	elif event is InputEventScreenDrag:
		var d: InputEventScreenDrag = event
		if d.index == _touch_index:
			_update_stick(d.position - center)
			accept_event()
	elif event is InputEventMouseButton:
		var m: InputEventMouseButton = event
		if m.button_index == MOUSE_BUTTON_LEFT:
			if m.pressed and _touch_index == -1:
				_touch_index = -2
				_update_stick(m.position - center)
				accept_event()
			elif (not m.pressed) and _touch_index == -2:
				_touch_index = -1
				_update_stick(Vector2.ZERO)
				accept_event()
	elif event is InputEventMouseMotion:
		if _touch_index == -2:
			_update_stick(event.position - center)
			accept_event()

func _update_stick(offset: Vector2) -> void:
	if offset.length() > MAX_OFFSET:
		offset = offset.normalized() * MAX_OFFSET
	_stick_offset = offset
	var v := offset / MAX_OFFSET
	if v.length() < DEADZONE:
		v = Vector2.ZERO
	value = v
	queue_redraw()
