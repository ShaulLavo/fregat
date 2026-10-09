[
  (let_declaration)
  (expression_statement)
  (use_declaration)
  (impl_item)
] @merge.unit
(function_item name: (_) @merge.signature) @merge.unit
(struct_item name: (_) @merge.signature) @merge.unit
(enum_item name: (_) @merge.signature) @merge.unit
(trait_item name: (_) @merge.signature) @merge.unit
(mod_item name: (_) @merge.signature) @merge.unit
(const_item name: (_) @merge.signature) @merge.unit
(type_item name: (_) @merge.signature) @merge.unit
(field_declaration name: (_) @merge.signature) @merge.unit
(field_initializer field: (_) @merge.signature) @merge.unit
(arguments (_) @merge.unit)
(parameters (_) @merge.unit)
(array_expression (_) @merge.unit)
(use_list (_) @merge.unit @merge.signature)
(use_list) @merge.commutative
