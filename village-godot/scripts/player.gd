extends CharacterBody2D

const SPEED := 220.0

var _joystick: Node = null

func _physics_process(_delta: float) -> void:
	if _joystick == null:
		_joystick = get_tree().get_first_node_in_group("joystick")

	var dir := Vector2.ZERO
	dir.x = Input.get_axis("move_left", "move_right")
	dir.y = Input.get_axis("move_up", "move_down")

	if _joystick != null and _joystick.value.length() > 0.0:
		dir = _joystick.value

	if dir.length() > 1.0:
		dir = dir.normalized()
	velocity = dir * SPEED
	move_and_slide()
