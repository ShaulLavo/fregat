[
  (expression_statement)
  (lexical_declaration)
  (variable_declaration)
  (return_statement)
  (throw_statement)
  (if_statement)
  (for_statement)
  (for_in_statement)
  (while_statement)
  (try_statement)
  (import_statement)
  (export_statement)
] @merge.unit
(function_declaration name: (_) @merge.signature) @merge.unit
(generator_function_declaration name: (_) @merge.signature) @merge.unit
(class_declaration name: (_) @merge.signature) @merge.unit
(method_definition name: (_) @merge.signature) @merge.unit
(pair key: (_) @merge.signature) @merge.unit
(import_specifier name: (_) @merge.signature) @merge.unit
(named_imports) @merge.commutative
(arguments (_) @merge.unit)
(array (_) @merge.unit)
(formal_parameters (_) @merge.unit)
; Initializers, computed keys and spreads can make declaration order observable.
(class_body (method_definition name: [(property_identifier) (private_property_identifier) (string) (number)])+ @_merge.member) @merge.commutative
(object (pair key: [(property_identifier) (string) (number)] value: [(number) (string) (true) (false) (null)])+ @_merge.member) @merge.commutative
