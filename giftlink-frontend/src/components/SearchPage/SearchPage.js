import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import 'bootstrap/dist/css/bootstrap.min.css';
import './SearchPage.css';
import { urlConfig } from '../../config';

function SearchPage() {
    const [searchQuery, setSearchQuery] = useState('');
    const [ageRange, setAgeRange] = useState(6);
    const [searchResults, setSearchResults] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const categories = ['Living', 'Bedroom', 'Bathroom', 'Kitchen', 'Office'];
    const conditions = ['New', 'Like New', 'Older'];
    const navigate = useNavigate();

    useEffect(() => {
        const fetchProducts = async () => {
            try {
                const response = await fetch(`${urlConfig.backendUrl}/api/gifts`);
                if (!response.ok) {
                    throw new Error(`HTTP error: ${response.status}`);
                }
                setSearchResults(await response.json());
            } catch (err) {
                console.error('Fetch error:', err);
                setError('Unable to load gifts. Please try again.');
            } finally {
                setLoading(false);
            }
        };
        fetchProducts();
    }, []);

    const handleSearch = async () => {
        const queryParams = new URLSearchParams({
            name: searchQuery,
            age_years: ageRange,
            category: document.getElementById('categorySelect').value,
            condition: document.getElementById('conditionSelect').value,
        }).toString();
        setLoading(true);
        setError('');
        try {
            const response = await fetch(`${urlConfig.backendUrl}/api/search?${queryParams}`);
            if (!response.ok) {
                throw new Error('Search failed');
            }
            setSearchResults(await response.json());
        } catch (err) {
            console.error('Failed to fetch search results:', err);
            setError('Search failed. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const goToDetailsPage = (productId) => {
        navigate(`/app/product/${productId}`);
    };

    return (
        <div className="container mt-5 search-page">
            <div className="row justify-content-center">
                <div className="col-md-6">
                    <div className="filter-section mb-3 p-3 border rounded">
                        <h5>Filters</h5>
                        <div className="d-flex flex-column">
                            <label htmlFor="categorySelect">Category</label>
                            <select id="categorySelect" className="form-control my-1 dropdown-filter">
                                <option value="">All</option>
                                {categories.map(category => (
                                    <option key={category} value={category}>{category}</option>
                                ))}
                            </select>

                            <label htmlFor="conditionSelect">Condition</label>
                            <select id="conditionSelect" className="form-control my-1 dropdown-filter">
                                <option value="">All</option>
                                {conditions.map(condition => (
                                    <option key={condition} value={condition}>{condition}</option>
                                ))}
                            </select>

                            <label htmlFor="ageRange">Less than {ageRange} years</label>
                            <input
                                type="range"
                                className="form-control-range age-range-slider"
                                id="ageRange"
                                min="1"
                                max="10"
                                value={ageRange}
                                onChange={e => setAgeRange(Number(e.target.value))}
                            />
                        </div>
                    </div>

                    <div className="search-bar">
                        <input
                            type="text"
                            className="form-control search-input"
                            placeholder="Search for items..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleSearch(); }}
                        />
                        <button className="btn btn-primary search-button" onClick={handleSearch}>Search</button>
                    </div>

                    <div className="search-results mt-4">
                        {loading ? (
                            <div>Loading...</div>
                        ) : error ? (
                            <div className="alert alert-danger" role="alert">{error}</div>
                        ) : searchResults.length > 0 ? (
                            searchResults.map(product => (
                                <div key={product.id} className="card search-results-card mb-3">
                                    {product.image ? (
                                        <img src={product.image} alt={product.name} className="card-img-top" />
                                    ) : (
                                        <div className="search-no-image">No Image Available</div>
                                    )}
                                    <div className="card-body">
                                        <h5 className="card-title">{product.name}</h5>
                                        <p className="card-text">{(product.description || '').slice(0, 100)}...</p>
                                    </div>
                                    <div className="card-footer">
                                        <button onClick={() => goToDetailsPage(product.id)} className="btn btn-primary">
                                            View More
                                        </button>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="alert alert-info search-empty" role="alert">
                                No products found. Please revise your filters.
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default SearchPage;
