[
  (expression_statement)
  (return_statement)
  (raise_statement)
  (import_statement)
  (import_from_statement)
  (if_statement)
  (for_statement)
  (while_statement)
  (try_statement)
  (with_statement)
] @merge.unit
(function_definition name: (identifier) @merge.signature) @merge.unit
(class_definition name: (identifier) @merge.signature) @merge.unit
(pair key: (_) @merge.signature) @merge.unit
(argument_list (_) @merge.unit)
(parameters (_) @merge.unit)
(list (_) @merge.unit)
(import_statement name: (_) @merge.unit @merge.signature)
(import_from_statement name: (_) @merge.unit @merge.signature)
