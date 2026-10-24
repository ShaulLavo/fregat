; Types
; -----

(type_identifier) @type
(predefined_type) @type.builtin

((identifier) @type
 (#match? @type "^[A-Z]"))

(type_arguments
  "<" @punctuation.bracket
  ">" @punctuation.bracket)

; Type annotations (e.g., `: THREE.PerspectiveCamera`)
(type_annotation
  (type_identifier) @type)

(type_annotation
  (nested_type_identifier
    module: (identifier) @namespace
    name: (type_identifier) @type))

; Generic type parameters
(type_parameter
  name: (type_identifier) @type.parameter)

; Type alias declarations (type Foo = ...)
(type_alias_declaration
  "type" @keyword.type
  name: (type_identifier) @type.definition)

; Interface declarations
(interface_declaration
  "interface" @keyword.type
  name: (type_identifier) @type.definition)

; Variables
; ---------

(required_parameter (identifier) @variable.parameter)
(optional_parameter (identifier) @variable.parameter)

; "import type" - the type keyword should match import color
(import_statement
  "type" @keyword.import)

; TypeScript-specific Keywords (excluding type, interface which are handled above)

[
  "abstract"
  "declare"
  "enum"
  "implements"
  "keyof"
  "namespace"
  "private"
  "protected"
  "public"
  "readonly"
  "override"
  "satisfies"
  "infer"
  "extends"
  "typeof"
] @keyword
