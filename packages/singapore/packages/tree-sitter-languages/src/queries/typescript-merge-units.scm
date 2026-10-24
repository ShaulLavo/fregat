(interface_declaration name: (_) @merge.signature) @merge.unit
(type_alias_declaration name: (_) @merge.signature) @merge.unit
(enum_declaration name: (_) @merge.signature) @merge.unit
(property_signature name: (_) @merge.signature) @merge.unit
(method_signature name: (_) @merge.signature) @merge.unit
(public_field_definition name: (_) @merge.signature) @merge.unit
; Overload resolution depends on method and call-signature order.
(interface_body (property_signature)+ @_merge.member) @merge.commutative
