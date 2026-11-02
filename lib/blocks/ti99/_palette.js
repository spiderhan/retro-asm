'use strict';
// The TI-99/4A's 16 colours, in the order of the numbers the video chip uses (0 to 15).
// "rgb" is only for drawing the swatches in the blocks panel (they are close to what the chip shows).
module.exports = {
  palette: [
    { n: 0, name: 'See-through', rgb: null },
    { n: 1, name: 'Black', rgb: '#000000' },
    { n: 2, name: 'Green', rgb: '#21C842' },
    { n: 3, name: 'Light green', rgb: '#5EDC78' },
    { n: 4, name: 'Dark blue', rgb: '#5455ED' },
    { n: 5, name: 'Light blue', rgb: '#7D76FC' },
    { n: 6, name: 'Dark red', rgb: '#D4524D' },
    { n: 7, name: 'Cyan', rgb: '#42EBF5' },
    { n: 8, name: 'Red', rgb: '#FC5554' },
    { n: 9, name: 'Light red', rgb: '#FF7978' },
    { n: 10, name: 'Dark yellow', rgb: '#D4C154' },
    { n: 11, name: 'Light yellow', rgb: '#E6CE80' },
    { n: 12, name: 'Dark green', rgb: '#21B03B' },
    { n: 13, name: 'Magenta', rgb: '#C95BBA' },
    { n: 14, name: 'Grey', rgb: '#CCCCCC' },
    { n: 15, name: 'White', rgb: '#FFFFFF' }
  ]
};
