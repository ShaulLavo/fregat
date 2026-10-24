#include <tree_sitter/api.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>

extern const TSLanguage *tree_sitter_typescript(void);

static double now_ms(void) {
  struct timespec time;
  clock_gettime(CLOCK_MONOTONIC, &time);
  return time.tv_sec * 1000.0 + time.tv_nsec / 1000000.0;
}

int main(int argc, char **argv) {
  if (argc != 3) return 2;
  FILE *file = fopen(argv[1], "rb");
  if (!file || fseek(file, 0, SEEK_END)) return 3;
  long size = ftell(file);
  if (size <= 0 || size > UINT32_MAX || fseek(file, 0, SEEK_SET)) return 4;
  char *text = malloc((size_t)size);
  if (!text || fread(text, 1, (size_t)size, file) != (size_t)size) return 5;
  fclose(file);
  int repetitions = atoi(argv[2]);
  if (repetitions <= 0) return 6;
  printf("[");
  for (int index = 0; index < repetitions; index++) {
    TSParser *parser = ts_parser_new();
    if (!parser || !ts_parser_set_language(parser, tree_sitter_typescript())) return 7;
    double start = now_ms();
    TSTree *tree = ts_parser_parse_string(parser, NULL, text, (uint32_t)size);
    double elapsed = now_ms() - start;
    if (!tree || ts_node_end_byte(ts_tree_root_node(tree)) != (uint32_t)size) return 8;
    printf("%s{\"parseMs\":%.3f,\"bytes\":%ld,\"hasError\":%s}",
      index ? "," : "", elapsed, size, ts_node_has_error(ts_tree_root_node(tree)) ? "true" : "false");
    ts_tree_delete(tree);
    ts_parser_delete(parser);
  }
  printf("]\n");
  free(text);
  return 0;
}
