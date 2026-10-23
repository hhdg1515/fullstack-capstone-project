// Inclusion projections prevent future private fields entering public responses.
const publicGiftProjection = {
    _id: 1, id: 1, name: 1, category: 1, condition: 1, posted_by: 1, zipcode: 1,
    date_added: 1, age_days: 1, age_years: 1, description: 1, image: 1
};
module.exports = { publicGiftProjection };
