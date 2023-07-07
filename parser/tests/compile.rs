use std::fs::read_to_string;

#[test]
fn test_compile_includes_blocks() {
  let output = parser::compile("./tests/data/blocks/test.rec").unwrap();
  let expected = read_to_string("./tests/data/blocks/test.recc").unwrap();
  assert_eq!(expected, output);
}