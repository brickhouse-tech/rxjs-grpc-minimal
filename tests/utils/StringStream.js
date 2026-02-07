const { Readable } = require('stream');

module.exports = class StringStream extends Readable {
  constructor(str) {
    super();
    this.push(str);
    this.push(null);
  }

  _read() {}
};
