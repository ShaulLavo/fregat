[
  (const_declaration)
  (var_declaration)
  (type_declaration)
  (short_var_declaration)
  (assignment_statement)
  (expression_statement)
  (return_statement)
  (if_statement)
  (for_statement)
] @merge.unit
(function_declaration name: (_) @merge.signature) @merge.unit
(method_declaration name: (_) @merge.signature) @merge.unit
(field_declaration) @merge.unit
(field_declaration name: (_) @merge.unit @merge.signature)
(import_spec path: (_) @merge.signature) @merge.unit
(import_spec_list) @merge.commutative
(argument_list (_) @merge.unit)
(parameter_list (_) @merge.unit)
(type_spec name: (_) @merge.signature) @merge.unit
(method_elem name: (_) @merge.signature) @merge.unit
